"""JSON-RPC API shaped like Pirsonal's Template_Video_New.

Clients POST to /api:

    {"jsonrpc":"2.0","id":1,"method":"Template_Video_New",
     "params":{"templateID":"<id>","name":"Hello","description":"",
               "data":{"headline":"Ada"}}}

`data` may be an object or a JSON string. Keys may include the leading $.
The call stores a row (video id + template id) and returns at once.
Encoding continues in the background, then the mp4 is uploaded to S3.
The same template and text values are not encoded again.
"""
import json
import os
import uuid

import video_catalog
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
            result = _video_get(fields.get("id") or fields.get("videoID"), base_url)
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
    labels = {var["label"] for var in record.get("variables") or []}
    # These are request fields, not text, unless a layer is actually named that.
    reserved = {"values", "templateID", "templateId", "name", "description", "inputs", "webhook"}
    provided = {}
    if isinstance(parsed, dict):
        for key, value in parsed.items():
            name = key[1:] if isinstance(key, str) and key.startswith("$") else key
            if name not in labels and name in reserved:
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
    data_param = fields.get("data")
    if not isinstance(data_param, str):
        data_param = json.dumps(data_param if data_param is not None else values)
    digest = video_catalog.data_hash(record, values)
    try:
        existing = video_catalog.find_reusable(record["id"], digest)
    except video_catalog.CatalogError as exc:
        raise RpcError(5000, str(exc))
    if existing:
        return video_catalog._row_to_video(existing, base_url)
    render_id = uuid.uuid4().hex[:12]
    webhook = fields.get("webhook") or fields.get("notifyUrl")
    try:
        video_catalog.begin_render(
            render_id,
            record,
            values,
            fields.get("name") or record["name"],
            fields.get("description") or "",
            data_param,
            digest,
            webhook,
            base_url,
        )
        row = video_catalog.get(render_id)
    except video_catalog.CatalogError as exc:
        raise RpcError(5000, str(exc))
    return video_catalog._row_to_video(row, base_url)


def _video_get(render_id, base_url):
    if not render_id:
        raise RpcError(1007, "Video not found")
    try:
        row = video_catalog.get(render_id)
    except video_catalog.CatalogError as exc:
        raise RpcError(5000, str(exc))
    if not row:
        raise RpcError(1007, "Video not found")
    return video_catalog._row_to_video(row, base_url)


def render_file(render_id):
    path = os.path.join(RENDERS_DIR, f"{render_id}.mp4")
    if not os.path.exists(path):
        return None
    return path


def _fail(call_id, code, message):
    return {"jsonrpc": "2.0", "id": call_id, "error": {"code": code, "message": message}}
