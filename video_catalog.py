"""Store finished videos in MySQL and S3.

A render row links the generated video id to its template id. Repeat calls
with the same template and the same text reuse the stored file instead of
encoding again.
"""
import hashlib
import json
import os
import tempfile
import threading
import time
from datetime import datetime, timezone

import boto3
from botocore.exceptions import BotoCoreError, ClientError

import video_render
import video_store

_schema_ready = False
_schema_lock = threading.Lock()


class CatalogError(Exception):
    pass


def mysql_configured():
    return all(os.environ.get(name) for name in (
        "MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE",
    ))


def s3_configured():
    return bool(os.environ.get("S3_BUCKET", "").strip())


def data_hash(record, values):
    """Fingerprint the template layout and the text so a later edit re-encodes."""
    try:
        stat = os.stat(video_store.video_path(record["id"]))
        video_sig = [stat.st_size, stat.st_mtime_ns]
    except (OSError, video_store.VideoNotFound):
        video_sig = None
    payload = json.dumps(
        {
            "template": record["id"],
            "width": record.get("width"),
            "height": record.get("height"),
            "duration": record.get("duration"),
            "variables": record.get("variables"),
            "video": video_sig,
            "values": values,
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _connect():
    if not mysql_configured():
        raise CatalogError("MySQL is not configured. Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE.")
    import pymysql

    return pymysql.connect(
        host=os.environ["MYSQL_HOST"],
        user=os.environ["MYSQL_USER"],
        password=os.environ["MYSQL_PASSWORD"],
        database=os.environ["MYSQL_DATABASE"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        connect_timeout=10,
    )


def ensure_schema():
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        sql = """
        CREATE TABLE IF NOT EXISTS ie_rendered_videos (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            template_id VARCHAR(32) NOT NULL,
            name VARCHAR(255) NOT NULL DEFAULT '',
            description TEXT,
            data_json MEDIUMTEXT,
            data_hash CHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL,
            error_message TEXT,
            s3_bucket VARCHAR(128) DEFAULT NULL,
            s3_key VARCHAR(512) DEFAULT NULL,
            file_size BIGINT DEFAULT NULL,
            duration_ms INT DEFAULT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            KEY idx_template_hash (template_id, data_hash, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
        conn = _connect()
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
        finally:
            conn.close()
        _schema_ready = True


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _row_to_video(row, base_url):
    if not row:
        return None
    done = row["status"] == "done" and row.get("s3_key")
    url = f"{base_url}/renders/{row['id']}.mp4" if done else None
    out_files = []
    if done:
        out_files.append({
            "name": f"{row['id']}.mp4",
            "profile": "MP4_H264_AAC",
            "size": int(row["file_size"] or 0),
            "url": url,
            "storage": {
                "bucket": row.get("s3_bucket"),
                "key": row.get("s3_key"),
            },
        })
    status = row["status"]
    if status == "error":
        status_obj = {"code": "error", "message": row.get("error_message") or "Render failed"}
    else:
        status_obj = {"code": status}
    return {
        "id": row["id"],
        "templateID": row["template_id"],
        "name": row.get("name") or "",
        "description": row.get("description") or "",
        "duration": int(row["duration_ms"] or 0),
        "date": row["created_at"].strftime("%Y-%m-%dT%H:%M:%S.000Z") if row.get("created_at") else None,
        "status": status_obj,
        "data": row.get("data_json") or "",
        "url": url,
        "outFiles": out_files,
    }


def get(render_id):
    ensure_schema()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM ie_rendered_videos WHERE id=%s", (render_id,))
            return cur.fetchone()
    finally:
        conn.close()


def wait_for(render_id, timeout_seconds=280):
    """Block until the row is done or failed, or the timeout is reached."""
    deadline = time.time() + timeout_seconds
    while True:
        row = get(render_id)
        if not row or row["status"] in ("done", "error") or time.time() >= deadline:
            return row
        time.sleep(1)


def find_reusable(template_id, digest):
    ensure_schema()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM ie_rendered_videos
                WHERE template_id=%s AND data_hash=%s AND status IN ('done', 'processing')
                ORDER BY FIELD(status, 'done', 'processing'), created_at DESC
                LIMIT 1
                """,
                (template_id, digest),
            )
            row = cur.fetchone()
            if row and _is_stale_processing(row):
                cur.execute(
                    """
                    UPDATE ie_rendered_videos
                    SET status='error', error_message=%s, updated_at=%s
                    WHERE id=%s AND status='processing'
                    """,
                    ("Render did not finish.", _now(), row["id"]),
                )
                return None
            return row
    finally:
        conn.close()


def _is_stale_processing(row):
    if row.get("status") != "processing" or not row.get("updated_at"):
        return False
    age = datetime.now(timezone.utc).replace(tzinfo=None) - row["updated_at"]
    return age.total_seconds() > 30 * 60


def insert_processing(render_id, template_id, name, description, data_json, digest, duration_ms):
    ensure_schema()
    now = _now()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ie_rendered_videos
                    (id, template_id, name, description, data_json, data_hash, status,
                     duration_ms, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, 'processing', %s, %s, %s)
                """,
                (render_id, template_id, name or "", description or "", data_json, digest, duration_ms, now, now),
            )
    finally:
        conn.close()


def mark_done(render_id, bucket, key, file_size):
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ie_rendered_videos
                SET status='done', s3_bucket=%s, s3_key=%s, file_size=%s,
                    error_message=NULL, updated_at=%s
                WHERE id=%s
                """,
                (bucket, key, file_size, _now(), render_id),
            )
    finally:
        conn.close()


def mark_error(render_id, message):
    try:
        ensure_schema()
        conn = _connect()
    except Exception:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE ie_rendered_videos
                SET status='error', error_message=%s, updated_at=%s
                WHERE id=%s
                """,
                (message[:2000], _now(), render_id),
            )
    finally:
        conn.close()


def _s3():
    if not s3_configured():
        raise CatalogError("S3_BUCKET is not set.")
    region = os.environ.get("AWS_DEFAULT_REGION") or os.environ.get("AWS_REGION") or "ap-south-1"
    return boto3.client("s3", region_name=region)


def _object_key(template_id, render_id):
    prefix = (os.environ.get("S3_PREFIX") or "rendered-videos").strip().strip("/")
    return f"{prefix}/{template_id}/{render_id}.mp4"


def upload_mp4(local_path, template_id, render_id):
    bucket = os.environ["S3_BUCKET"].strip()
    key = _object_key(template_id, render_id)
    try:
        _s3().upload_file(
            local_path,
            bucket,
            key,
            ExtraArgs={"ContentType": "video/mp4"},
        )
    except (BotoCoreError, ClientError) as exc:
        raise CatalogError(f"Could not upload the video to S3: {exc}") from exc
    return bucket, key, os.path.getsize(local_path)


def open_s3(row, range_header):
    kwargs = {"Bucket": row["s3_bucket"], "Key": row["s3_key"]}
    if range_header:
        kwargs["Range"] = range_header
    try:
        return _s3().get_object(**kwargs)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("InvalidRange", "416"):
            raise CatalogError("Invalid range") from exc
        raise CatalogError("Stored video could not be read from S3.") from exc


def render_and_store(render_id, record, values, webhook, base_url):
    tmp_path = None
    try:
        mp4 = video_render.render_video(record, video_store.video_path(record["id"]), values)
        fd, tmp_path = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        with open(tmp_path, "wb") as handle:
            handle.write(mp4)
        bucket, key, size = upload_mp4(tmp_path, record["id"], render_id)
        mark_done(render_id, bucket, key, size)
        if isinstance(webhook, str) and webhook.startswith("http"):
            row = get(render_id)
            if row:
                _notify(webhook, _row_to_video(row, base_url))
    except Exception as exc:
        mark_error(render_id, str(exc))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


def begin_render(render_id, record, values, name, description, data_json, digest, webhook, base_url):
    insert_processing(
        render_id,
        record["id"],
        name,
        description,
        data_json,
        digest,
        int(round(float(record["duration"]) * 1000)),
    )
    thread = threading.Thread(
        target=render_and_store,
        args=(render_id, record, values, webhook, base_url),
        daemon=False,
        name=f"render-{render_id}",
    )
    thread.start()


def _notify(url, video):
    import urllib.request
    payload = json.dumps(video).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "image-editor"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=10).close()
    except Exception:
        pass
