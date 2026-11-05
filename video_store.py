"""Local storage for video templates.

Each video template is a folder under data/videos/<id>/:
  - base.<ext>     the uploaded source video
  - poster.jpg     a still used in the library
  - template.json  name, size, duration, timed text variables

Image templates in data/templates/ are not read or written here.
"""
import json
import os
import re
import shutil
import uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VIDEOS_DIR = os.path.join(BASE_DIR, "data", "videos")

os.makedirs(VIDEOS_DIR, exist_ok=True)

LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,49}$")

MIME_BY_EXT = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
}


class VideoNotFound(Exception):
    pass


class InvalidVideoTemplate(ValueError):
    pass


def _dir(video_id):
    return os.path.join(VIDEOS_DIR, video_id)


def _json_path(video_id):
    return os.path.join(_dir(video_id), "template.json")


def mime_for(filename):
    ext = os.path.splitext(filename or "")[1].lower()
    return MIME_BY_EXT.get(ext, "application/octet-stream")


def _as_seconds(value, label, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidVideoTemplate(f"Text '{label}' needs a numeric {field} in seconds.")
    seconds = float(value)
    if seconds < 0:
        raise InvalidVideoTemplate(f"Text '{label}' has a negative {field}.")
    return round(seconds, 3)


def validate_variables(variables, duration=None):
    if not isinstance(variables, list) or not variables:
        raise InvalidVideoTemplate("A video template needs at least one text layer.")
    seen = set()
    for var in variables:
        label = var.get("label")
        if not LABEL_RE.match(label or ""):
            raise InvalidVideoTemplate(
                f"Text label '{label}' is invalid. Use letters, numbers, underscores, "
                "starting with a letter (max 50 chars)."
            )
        if label in seen:
            raise InvalidVideoTemplate(f"Duplicate text label: '{label}'")
        seen.add(label)
        for field in ("x", "y", "width", "font_size"):
            if not isinstance(var.get(field), (int, float)):
                raise InvalidVideoTemplate(f"Text '{label}' is missing numeric field '{field}'.")
        start = _as_seconds(var.get("start", 0), label, "start")
        end = _as_seconds(var.get("end", start + 3), label, "end")
        if end <= start:
            raise InvalidVideoTemplate(f"Text '{label}' must end after it starts.")
        if duration is not None:
            limit = float(duration)
            if start >= limit:
                raise InvalidVideoTemplate(f"Text '{label}' starts after the video ends.")
            if end > limit:
                if end - limit <= 0.5:
                    end = round(limit, 3)
                else:
                    raise InvalidVideoTemplate(
                        f"Text '{label}' ends at {end:.2f}s, past the {limit:.2f}s video."
                    )
            if end <= start:
                raise InvalidVideoTemplate(f"Text '{label}' must end after it starts.")
        var["start"] = start
        var["end"] = end
        var.setdefault("color", "#ffffff")
        var.setdefault("align", "left")
        var.setdefault("font", "roboto")
        var.setdefault("default_text", label)
        var.setdefault("line_height", 1.2)
        if var["align"] not in ("left", "center", "right"):
            raise InvalidVideoTemplate(f"Text '{label}' has invalid align '{var['align']}'.")


def create_video(name, video_path, video_ext, width, height, duration, has_audio, variables, poster_path=None):
    validate_variables(variables, duration)
    video_id = uuid.uuid4().hex[:12]
    folder = _dir(video_id)
    os.makedirs(folder, exist_ok=True)
    filename = f"base{video_ext}"
    record = {
        "id": video_id,
        "kind": "video",
        "name": name or "Untitled video",
        "video_file": filename,
        "width": int(width),
        "height": int(height),
        "duration": round(float(duration), 3),
        "has_audio": bool(has_audio),
        "variables": variables,
    }
    try:
        shutil.move(video_path, os.path.join(folder, filename))
        if poster_path and os.path.exists(poster_path):
            shutil.move(poster_path, os.path.join(folder, "poster.jpg"))
            record["poster"] = "poster.jpg"
        with open(_json_path(video_id), "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        if os.path.exists(video_path):
            os.remove(video_path)
        raise
    return record


def update_video(video_id, name=None, variables=None):
    record = get_video(video_id)
    if name is not None:
        record["name"] = name
    if variables is not None:
        validate_variables(variables, record.get("duration"))
        record["variables"] = variables
    with open(_json_path(video_id), "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
    return record


def get_video(video_id):
    path = _json_path(video_id)
    if not os.path.exists(path):
        raise VideoNotFound(video_id)
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def video_path(video_id):
    record = get_video(video_id)
    path = os.path.join(_dir(video_id), record["video_file"])
    if not os.path.exists(path):
        raise VideoNotFound(video_id)
    return path


def poster_path(video_id):
    record = get_video(video_id)
    name = record.get("poster")
    if not name:
        return None
    path = os.path.join(_dir(video_id), name)
    return path if os.path.exists(path) else None


def list_videos():
    out = []
    if not os.path.isdir(VIDEOS_DIR):
        return out
    for video_id in sorted(os.listdir(VIDEOS_DIR)):
        path = _json_path(video_id)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as handle:
            record = json.load(handle)
        out.append({
            "id": record["id"],
            "name": record["name"],
            "width": record["width"],
            "height": record["height"],
            "duration": record.get("duration") or 0,
            "variable_count": len(record.get("variables") or []),
            "labels": [v["label"] for v in record.get("variables") or []],
            "has_poster": bool(record.get("poster")),
        })
    return out


def delete_video(video_id):
    folder = _dir(video_id)
    if not os.path.isdir(folder) or not os.path.exists(_json_path(video_id)):
        raise VideoNotFound(video_id)
    shutil.rmtree(folder)
