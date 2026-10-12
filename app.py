#!/usr/bin/env python3
"""Image template tool.

Create a reusable image template with positioned text variables (font,
size, color, alignment), then render finished images by POSTing variable
values to an API endpoint.
"""
import json
import os
import tempfile

from flask import Flask, abort, jsonify, render_template, request, send_file
from PIL import Image
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix

import pirsonal_api
import render as renderer
import store
import video_render
import video_store


def _load_env_file():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):]
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # video uploads; images stay capped below

ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_VIDEO_EXT = {".mp4", ".m4v", ".mov", ".webm"}
IMAGE_UPLOAD_LIMIT = 20 * 1024 * 1024


@app.before_request
def keep_image_upload_limit():
    # Image templates keep the original 20 MB cap. Video uploads use the higher app limit.
    if request.endpoint == "api_templates" and request.method == "POST":
        if (request.content_length or 0) > IMAGE_UPLOAD_LIMIT:
            raise RequestEntityTooLarge()


# ---------------------------------------------------------------- pages ----

@app.route("/")
def index():
    templates = store.list_templates()
    return render_template("index.html", templates=templates)


@app.route("/new")
def new_template_page():
    fonts = renderer.load_font_manifest()
    return render_template("editor.html", fonts=fonts, template=None)


@app.route("/templates/<template_id>/edit")
def edit_template_page(template_id):
    try:
        record = store.get_template(template_id)
    except store.TemplateNotFound:
        abort(404)
    fonts = renderer.load_font_manifest()
    return render_template("editor.html", fonts=fonts, template=record)


@app.route("/templates/<template_id>/preview")
def preview_template_page(template_id):
    try:
        record = store.get_template(template_id)
    except store.TemplateNotFound:
        abort(404)
    root = public_base()
    api_url = root + f"/api/templates/{template_id}/render"
    short_url = root + f"/{template_id}"
    return render_template("preview.html", template=record, api_url=api_url, short_url=short_url)


@app.route("/template-image/<template_id>")
def template_image(template_id):
    try:
        source, mimetype = store.read_template_image(template_id)
    except store.TemplateNotFound:
        abort(404)
    return send_file(source, mimetype=mimetype, max_age=3600)


def public_base():
    return request.url_root.rstrip("/") + (request.script_root or "")


# ------------------------------------------------------------------ api ----

@app.route("/api/fonts")
def api_fonts():
    return jsonify(renderer.load_font_manifest())


@app.route("/api/templates", methods=["GET", "POST"])
def api_templates():
    if request.method == "GET":
        return jsonify(store.list_templates())

    # POST: create a new template
    name = request.form.get("name", "").strip()
    variables_raw = request.form.get("variables")
    image_file = request.files.get("image")

    if not image_file or image_file.filename == "":
        return jsonify(error="Missing 'image' file."), 400
    if not variables_raw:
        return jsonify(error="Missing 'variables' JSON."), 400

    ext = os.path.splitext(image_file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return jsonify(error=f"Unsupported image type '{ext}'."), 400

    try:
        variables = json.loads(variables_raw)
    except json.JSONDecodeError as e:
        return jsonify(error=f"Invalid 'variables' JSON: {e}"), 400

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=ext)
    os.close(tmp_fd)
    image_file.save(tmp_path)

    try:
        with Image.open(tmp_path) as img:
            width, height = img.size
    except Exception:
        os.remove(tmp_path)
        return jsonify(error="Uploaded file is not a valid image."), 400

    try:
        record = store.create_template(name, tmp_path, ext, width, height, variables)
    except store.InvalidTemplate as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return jsonify(error=str(e)), 400

    return jsonify(record), 201


@app.route("/api/templates/<template_id>", methods=["GET", "PUT", "DELETE"])
def api_template_detail(template_id):
    if request.method == "GET":
        try:
            return jsonify(store.get_template(template_id))
        except store.TemplateNotFound:
            return jsonify(error="Template not found."), 404

    if request.method == "DELETE":
        try:
            store.delete_template(template_id)
        except store.TemplateNotFound:
            return jsonify(error="Template not found."), 404
        return "", 204

    # PUT: update name and/or variables (image stays the same)
    body = request.get_json(silent=True) or {}
    try:
        record = store.update_template(
            template_id,
            name=body.get("name"),
            variables=body.get("variables"),
        )
    except store.TemplateNotFound:
        return jsonify(error="Template not found."), 404
    except store.InvalidTemplate as e:
        return jsonify(error=str(e)), 400
    return jsonify(record)


@app.route("/api/templates/<template_id>/render", methods=["GET", "POST"])
def api_render(template_id):
    if request.method == "GET":
        values = request.args.to_dict()
        out_format = values.pop("format", "png")
    else:
        body = request.get_json(silent=True)
        if body is None:
            values = request.form.to_dict()
            out_format = request.args.get("format", "png")
        else:
            values = body.get("values", body)
            out_format = body.get("format") or request.args.get("format", "png")

    if not isinstance(values, dict):
        return jsonify(error="Provide variable values as a JSON object, e.g. {\"values\": {\"headline\": \"Hi\"}}."), 400

    return render_image_response(template_id, values, out_format)


def render_image_response(template_id, values, out_format):
    try:
        record = store.get_template(template_id)
        image_source, _image_type = store.read_template_image(template_id)
    except store.TemplateNotFound:
        return jsonify(error="Template not found."), 404

    try:
        image_bytes, mimetype = renderer.render_template(record, image_source, values, out_format)
    except Exception as e:
        return jsonify(error=f"Render failed: {e}"), 500

    return send_file(
        io_bytes(image_bytes),
        mimetype=mimetype,
        download_name=f"{template_id}.{'jpg' if 'jpeg' in mimetype else 'png'}",
    )


def io_bytes(data):
    import io
    return io.BytesIO(data)


# ---------------------------------------------------------------- videos ----

@app.route("/videos")
def videos_index():
    return render_template("videos.html", videos=video_store.list_videos())


@app.route("/videos/new")
def new_video_page():
    fonts = renderer.load_font_manifest()
    return render_template("video_editor.html", fonts=fonts, video=None)


@app.route("/videos/<video_id>/edit")
def edit_video_page(video_id):
    try:
        record = video_store.get_video(video_id)
    except video_store.VideoNotFound:
        abort(404)
    fonts = renderer.load_font_manifest()
    return render_template("video_editor.html", fonts=fonts, video=record)


@app.route("/videos/<video_id>/preview")
def preview_video_page(video_id):
    try:
        record = video_store.get_video(video_id)
    except video_store.VideoNotFound:
        abort(404)
    root = public_base()
    return render_template(
        "video_preview.html",
        video=record,
        api_url=root + f"/api/videos/{video_id}/render",
        short_url=root + f"/v/{video_id}",
        rpc_url=root + "/api",
    )


@app.route("/video-file/<video_id>")
def video_file(video_id):
    try:
        path = video_store.video_path(video_id)
        record = video_store.get_video(video_id)
    except video_store.VideoNotFound:
        abort(404)
    return send_file(path, mimetype=video_store.mime_for(record.get("video_file")), conditional=True)


@app.route("/video-poster/<video_id>")
def video_poster(video_id):
    try:
        path = video_store.poster_path(video_id)
    except video_store.VideoNotFound:
        abort(404)
    if not path:
        abort(404)
    return send_file(path, mimetype="image/jpeg", max_age=3600)


@app.route("/api/videos", methods=["GET", "POST"])
def api_videos():
    if request.method == "GET":
        return jsonify(video_store.list_videos())

    name = request.form.get("name", "").strip()
    variables_raw = request.form.get("variables")
    video_file_upload = request.files.get("video")
    if not video_file_upload or video_file_upload.filename == "":
        return jsonify(error="Missing 'video' file."), 400
    if not variables_raw:
        return jsonify(error="Missing 'variables' JSON."), 400
    ext = os.path.splitext(video_file_upload.filename)[1].lower()
    if ext not in ALLOWED_VIDEO_EXT:
        return jsonify(error=f"Unsupported video type '{ext}'."), 400
    try:
        variables = json.loads(variables_raw)
    except json.JSONDecodeError as exc:
        return jsonify(error=f"Invalid 'variables' JSON: {exc}"), 400

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=ext)
    os.close(tmp_fd)
    poster_path = None
    video_file_upload.save(tmp_path)
    try:
        width, height, duration, has_audio = video_render.probe_video(tmp_path)
        poster_fd, poster_path = tempfile.mkstemp(suffix=".jpg")
        os.close(poster_fd)
        try:
            video_render.write_poster(tmp_path, poster_path)
        except video_render.VideoRenderError:
            os.remove(poster_path)
            poster_path = None
        record = video_store.create_video(
            name, tmp_path, ext, width, height, duration, has_audio, variables, poster_path
        )
    except video_store.InvalidVideoTemplate as exc:
        _cleanup_upload(tmp_path, poster_path)
        return jsonify(error=str(exc)), 400
    except video_render.VideoRenderError as exc:
        _cleanup_upload(tmp_path, poster_path)
        return jsonify(error=str(exc)), 500
    except Exception as exc:
        _cleanup_upload(tmp_path, poster_path)
        return jsonify(error=f"Could not save video: {exc}"), 500
    return jsonify(record), 201


@app.route("/api/videos/<video_id>", methods=["GET", "PUT", "DELETE"])
def api_video_detail(video_id):
    if request.method == "GET":
        try:
            return jsonify(video_store.get_video(video_id))
        except video_store.VideoNotFound:
            return jsonify(error="Video template not found."), 404

    if request.method == "DELETE":
        try:
            video_store.delete_video(video_id)
        except video_store.VideoNotFound:
            return jsonify(error="Video template not found."), 404
        return "", 204

    body = request.get_json(silent=True) or {}
    try:
        record = video_store.update_video(
            video_id,
            name=body.get("name"),
            variables=body.get("variables"),
        )
    except video_store.VideoNotFound:
        return jsonify(error="Video template not found."), 404
    except video_store.InvalidVideoTemplate as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(record)


@app.route("/api/videos/<video_id>/render", methods=["GET", "POST"])
def api_video_render(video_id):
    if request.method == "GET":
        values = request.args.to_dict()
    else:
        body = request.get_json(silent=True)
        if body is None:
            values = request.form.to_dict()
        else:
            values = body.get("values", body)
    if not isinstance(values, dict):
        return jsonify(error="Provide text values as a JSON object."), 400
    return render_video_response(video_id, values)


@app.route("/v/<video_id>")
def short_video_render(video_id):
    return render_video_response(video_id, request.args.to_dict())


@app.route("/api", methods=["POST"])
def pirsonal_rpc():
    """Pirsonal-compatible JSON-RPC. Template_Video_New renders a video template."""
    body = request.get_json(silent=True)
    if body is None:
        body = {}
    return jsonify(pirsonal_api.dispatch(body, public_base()))


@app.route("/renders/<render_id>.mp4")
def rendered_video(render_id):
    path = pirsonal_api.render_file(render_id)
    if not path:
        abort(404)
    return send_file(path, mimetype="video/mp4", conditional=True)


def render_video_response(video_id, values):
    try:
        record = video_store.get_video(video_id)
        path = video_store.video_path(video_id)
    except video_store.VideoNotFound:
        return jsonify(error="Video template not found."), 404
    try:
        data = video_render.render_video(record, path, values)
    except video_render.VideoRenderError as exc:
        return jsonify(error=str(exc)), 500
    except Exception as exc:
        return jsonify(error=f"Render failed: {exc}"), 500
    return send_file(io_bytes(data), mimetype="video/mp4", download_name=f"{video_id}.mp4")


def _cleanup_upload(video_path, poster_path):
    for path in (video_path, poster_path):
        if path and os.path.exists(path):
            os.remove(path)


# --------------------------------------------------------- short image URL ----
# GET /<template_id>?label=value&label2=value2  -> the rendered image, for
# dropping straight into <img src>, emails, no-code tools, etc. Placed last
# so it never shadows the more specific routes above (Flask/Werkzeug always
# prefers a literal path segment like "/new" or "/healthz" over this dynamic
# one anyway, but keeping it last keeps that intent obvious).
@app.route("/<template_id>")
def short_render(template_id):
    values = request.args.to_dict()
    out_format = values.pop("format", "png")
    return render_image_response(template_id, values, out_format)


@app.route("/healthz")
def healthz():
    return {
        "status": "ok",
        "image_storage": "local",
        "ffmpeg": video_render.ffmpeg_available(),
    }


class ScriptPrefixMiddleware:
    """Expose the app under URL_PREFIX when Apache strips that prefix."""

    def __init__(self, wsgi_app, prefix):
        self.wsgi_app = wsgi_app
        self.prefix = prefix

    def __call__(self, environ, start_response):
        if self.prefix:
            environ["SCRIPT_NAME"] = self.prefix
            path = environ.get("PATH_INFO") or "/"
            if path == self.prefix or path.startswith(self.prefix + "/"):
                environ["PATH_INFO"] = path[len(self.prefix):] or "/"
        return self.wsgi_app(environ, start_response)


_prefix = os.environ.get("URL_PREFIX", "").strip()
if _prefix and not _prefix.startswith("/"):
    _prefix = "/" + _prefix
_prefix = _prefix.rstrip("/")
if _prefix:
    app.wsgi_app = ScriptPrefixMiddleware(app.wsgi_app, _prefix)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


@app.errorhandler(HTTPException)
def handle_http_exception(e):
    if request.path.startswith("/api/"):
        return jsonify(error=e.description), e.code
    return e


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)
