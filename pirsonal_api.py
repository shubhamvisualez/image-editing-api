"""JSON-RPC API shaped like Pirsonal's Template_Video_New.

Clients POST to /api:

    {"jsonrpc":"2.0","id":1,"method":"Template_Video_New",
     "params":{"templateID":"<id>","name":"Hello","description":"",
               "data":{"headline":"Ada"}}}

`data` may be an object or a JSON string. Keys may include the leading $.
The call renders immediately and returns the video object, including the mp4 URL.
"""
import json
import os
import uuid
import urllib.request
from datetime import datetime, timezone

import video_render
import video_store

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RENDERS_DIR = os.path.join(BASE_DIR, "data", "renders")
os.makedirs(RENDERS_DIR, exist_ok=True)


class RpcError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def dispatch(body, base_url):
    if isinstance(body, list):
        return [dispatch(item, base_url) for item in body]
    if not isinstance(body, dict):
        return _fail(None, -32600, "Invalid request")
    call_id = body.get("id")
    method = body.get("method") or ""
    params = body.get("params", [])
    try:
        if method == "Template_List":
            result = _template_list()
        elif method == "Template_Get":
            result = _template_get(_positional(params, ["templateID"])["templateID"])
        elif method in ("Template_Video_New", "Template_VideoNew"):
            result = _video_new(params, base_url)
        elif method == "Video_Get":
            fields = _positional(params, ["id", "videoID"])
            result = _video_get(fields.get("id") or fields.get("videoID"))
        else:
            return _fail(call_id, -32601, "Method not found")
    except RpcError as exc:
        return _fail(call_id, exc.code, exc.message)
    except Exception as exc:
        return _fail(call_id, 5000, f"Internal Error: {exc}")
    return {"jsonrpc": "2.0", "id": call_id, "result": result}


def _positional(params, names):
    if params is None:
        params = []
    if isinstance(params, dict):
        return params
    if isinstance(params, list):
        out = {}
        for name, value in zip(names, params):
            out[name] = value
        return out
    raise RpcError(-32602, "Invalid params")


def _template_list():
    return [
        {
            "id": item["id"],
            "templateID": item["id"],
            "name": item["name"],
            "duration": int(round(float(item["duration"]) * 1000)),
            "width": item["width"],
            "height": item["height"],
            "labels": item["labels"],
        }
        for item in video_store.list_videos()
    ]


def _template_get(template_id):
    record = _load_template(template_id)
    return {
        "id": record["id"],
        "templateID": record["id"],
        "name": record["name"],
        "width": record["width"],
        "height": record["height"],
        "duration": int(round(float(record["duration"]) * 1000)),
        "variables": [
            {"name": var["label"], "id": var["label"], "start": var["start"], "end": var["end"]}
            for var in record["variables"]
        ],
    }


def _load_template(template_id):
    if not template_id:
        raise RpcError(1000, "Template not found")
    try:
        return video_store.get_video(template_id)
    except video_store.VideoNotFound:
        raise RpcError(1000, "Template not found")


def _values_from_data(data, record):
    parsed = data
    if isinstance(data, str):
        text = data.strip()
        if text:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = {}
        else:
            parsed = {}
    if isinstance(parsed, dict) and isinstance(parsed.get("values"), dict):
        parsed = parsed["values"]
    provided = {}
    if isinstance(parsed, dict):
        for key, value in parsed.items():
            name = key[1:] if isinstance(key, str) and key.startswith("$") else key
            if name in ("values", "templateID", "name", "description"):
                continue
            provided[name] = "" if value is None else str(value)
    values = {}
    missing = []
    for var in record["variables"]:
        label = var["label"]
        if label in provided:
            values[label] = provided[label]
        elif var.get("default_text"):
            values[label] = var["default_text"]
        else:
            missing.append(label)
    if missing:
        raise RpcError(2005, "Not all variables defined: " + ", ".join(missing))
    return values


def _video_new(params, base_url):
    fields = _positional(params, ["templateID", "name", "description", "data", "inputs", "webhook"])
    template_id = fields.get("templateID") or fields.get("templateId")
    record = _load_template(template_id)
    values = _values_from_data(fields.get("data"), record)
    try:
        mp4 = video_render.render_video(record, video_store.video_path(record["id"]), values)
    except video_render.VideoRenderError as exc:
        raise RpcError(1012, f"Error processing video: {exc}")
    render_id = uuid.uuid4().hex[:12]
    folder = RENDERS_DIR
    os.makedirs(folder, exist_ok=True)
    mp4_path = os.path.join(folder, f"{render_id}.mp4")
    with open(mp4_path, "wb") as handle:
        handle.write(mp4)
    data_param = fields.get("data")
    if not isinstance(data_param, str):
        data_param = json.dumps(data_param if data_param is not None else values)
    video = {
        "id": render_id,
        "templateID": record["id"],
        "name": fields.get("name") or record["name"],
        "description": fields.get("description") or "",
        "duration": int(round(float(record["duration"]) * 1000)),
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "status": {"code": "done"},
        "data": data_param,
        "url": f"{base_url}/renders/{render_id}.mp4",
        "outFiles": [
            {
                "name": f"{render_id}.mp4",
                "profile": "MP4_H264_AAC",
                "size": len(mp4),
                "url": f"{base_url}/renders/{render_id}.mp4",
                "storage": {"pirsonalID": render_id},
            }
        ],
    }
    with open(os.path.join(folder, f"{render_id}.json"), "w", encoding="utf-8") as handle:
        json.dump(video, handle, indent=2)
    webhook = fields.get("webhook") or fields.get("notifyUrl")
    if isinstance(webhook, str) and webhook.startswith("http"):
        _notify(webhook, video)
    return video


def _video_get(render_id):
    if not render_id:
        raise RpcError(1007, "Video not found")
    path = os.path.join(RENDERS_DIR, f"{render_id}.json")
    if not os.path.exists(path):
        raise RpcError(1007, "Video not found")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def render_file(render_id):
    path = os.path.join(RENDERS_DIR, f"{render_id}.mp4")
    if not os.path.exists(path):
        return None
    return path


def _notify(url, video):
    payload = json.dumps(video).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Pirsonal"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=10).close()
    except Exception:
        pass


def _fail(call_id, code, message):
    return {"jsonrpc": "2.0", "id": call_id, "error": {"code": code, "message": message}}
