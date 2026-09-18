#!/usr/bin/env python3
"""Image template tool.

Create a reusable image template with positioned text variables (font,
size, color, alignment), then render finished images by POSTing variable
values to an API endpoint.
"""
import json
import os
import tempfile
import uuid

from flask import Flask, abort, jsonify, render_template, request, send_file, send_from_directory
from PIL import Image
from werkzeug.exceptions import HTTPException

import render as renderer
import store

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB uploads

ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}


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
    api_url = request.url_root.rstrip("/") + f"/api/templates/{template_id}/render"
    short_url = request.url_root.rstrip("/") + f"/{template_id}"
    return render_template("preview.html", template=record, api_url=api_url, short_url=short_url)


@app.route("/template-image/<template_id>")
def template_image(template_id):
    try:
        path = store.get_template_image_path(template_id)
    except store.TemplateNotFound:
        abort(404)
    return send_file(path)


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
        image_path = store.get_template_image_path(template_id)
    except store.TemplateNotFound:
        return jsonify(error="Template not found."), 404

    try:
        image_bytes, mimetype = renderer.render_template(record, image_path, values, out_format)
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
    return {"status": "ok"}


@app.errorhandler(HTTPException)
def handle_http_exception(e):
    if request.path.startswith("/api/"):
        return jsonify(error=e.description), e.code
    return e


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)
