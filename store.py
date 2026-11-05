"""JSON-file storage for image templates.

Each template is a folder under data/templates/<id>/ containing:
  - base.<ext>     the uploaded source image
  - template.json  the template definition (name, canvas size, variables)
"""
import json
import os
import re
import shutil
import uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "data", "templates")

os.makedirs(TEMPLATES_DIR, exist_ok=True)


class TemplateNotFound(Exception):
    pass


class InvalidTemplate(ValueError):
    pass


MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _mime_for(filename):
    ext = os.path.splitext(filename or "")[1].lower()
    return MIME_BY_EXT.get(ext, "application/octet-stream")


def _template_dir(template_id):
    return os.path.join(TEMPLATES_DIR, template_id)


def _template_json_path(template_id):
    return os.path.join(_template_dir(template_id), "template.json")


LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,49}$")


def validate_label(label):
    if not LABEL_RE.match(label or ""):
        raise InvalidTemplate(
            f"Variable label '{label}' is invalid. Use letters, numbers, underscores, "
            "starting with a letter (max 50 chars)."
        )


def validate_variables(variables):
    if not isinstance(variables, list) or not variables:
        raise InvalidTemplate("A template needs at least one text variable.")
    seen = set()
    for v in variables:
        label = v.get("label")
        validate_label(label)
        if label in seen:
            raise InvalidTemplate(f"Duplicate variable label: '{label}'")
        seen.add(label)
        for field in ("x", "y", "width", "font_size"):
            if not isinstance(v.get(field), (int, float)):
                raise InvalidTemplate(f"Variable '{label}' is missing numeric field '{field}'")
        v.setdefault("height", None)
        v.setdefault("color", "#000000")
        v.setdefault("align", "left")
        v.setdefault("font", "roboto")
        v.setdefault("default_text", label)
        v.setdefault("line_height", 1.2)
        v.setdefault("bold", False)
        v.setdefault("italic", False)
        v.setdefault("underline", False)
        v.setdefault("strikethrough", False)
        v.setdefault("uppercase", False)
        v.setdefault("letter_spacing", 0)
        v.setdefault("bg_color", "")
        v.setdefault("stroke_color", "")
        v.setdefault("stroke_width", 0)
        v.setdefault("opacity", 1.0)
        v["bold"] = bool(v.get("bold", False))
        v["italic"] = bool(v.get("italic", False))
        v["underline"] = bool(v.get("underline", False))
        v["strikethrough"] = bool(v.get("strikethrough", False))
        v["uppercase"] = bool(v.get("uppercase", False))
        v["letter_spacing"] = float(v.get("letter_spacing") or 0)
        v["line_height"] = float(v.get("line_height") or 1.2)
        v["bg_color"] = str(v.get("bg_color") or "").strip()
        v["stroke_color"] = str(v.get("stroke_color") or "").strip()
        v["stroke_width"] = float(v.get("stroke_width") or 0)
        v["opacity"] = max(0.05, min(1.0, float(v.get("opacity") if v.get("opacity") is not None else 1.0)))
        if v["align"] not in ("left", "center", "right"):
            raise InvalidTemplate(f"Variable '{label}' has invalid align '{v['align']}'")


def create_template(name, image_path, image_ext, width, height, variables):
    validate_variables(variables)
    template_id = uuid.uuid4().hex[:12]
    tdir = _template_dir(template_id)
    os.makedirs(tdir, exist_ok=True)
    filename = f"base{image_ext}"

    record = {
        "id": template_id,
        "name": name or "Untitled template",
        "image_file": filename,
        "width": width,
        "height": height,
        "variables": variables,
    }

    dest = os.path.join(tdir, filename)
    try:
        shutil.move(image_path, dest)
        with open(_template_json_path(template_id), "w") as f:
            json.dump(record, f, indent=2)
    except Exception:
        shutil.rmtree(tdir, ignore_errors=True)
        if os.path.exists(image_path):
            os.remove(image_path)
        raise
    return record


def update_template(template_id, name=None, variables=None):
    record = get_template(template_id)
    if name is not None:
        record["name"] = name
    if variables is not None:
        validate_variables(variables)
        record["variables"] = variables
    with open(_template_json_path(template_id), "w") as f:
        json.dump(record, f, indent=2)
    return record


def get_template(template_id):
    path = _template_json_path(template_id)
    if not os.path.exists(path):
        raise TemplateNotFound(template_id)
    with open(path) as f:
        return json.load(f)


def get_template_image_path(template_id):
    record = get_template(template_id)
    path = os.path.join(_template_dir(template_id), record["image_file"])
    if not os.path.exists(path):
        raise TemplateNotFound(template_id)
    return path


def read_template_image(template_id):
    """Return (local file path, mimetype) for the base image."""
    record = get_template(template_id)
    return get_template_image_path(template_id), _mime_for(record.get("image_file"))


def list_templates():
    out = []
    if not os.path.isdir(TEMPLATES_DIR):
        return out
    for entry in os.scandir(TEMPLATES_DIR):
        if not entry.is_dir():
            continue
        try:
            record = get_template(entry.name)
        except (TemplateNotFound, json.JSONDecodeError):
            continue
        out.append(
            {
                "id": record["id"],
                "name": record.get("name", "Untitled"),
                "width": record.get("width"),
                "height": record.get("height"),
                "variables": [v["label"] for v in record.get("variables", [])],
                "updated_at": os.path.getmtime(_template_json_path(entry.name)),
            }
        )
    out.sort(key=lambda t: t.get("updated_at", 0), reverse=True)
    return out


def delete_template(template_id):
    tdir = _template_dir(template_id)
    if not os.path.isdir(tdir) or not os.path.exists(_template_json_path(template_id)):
        raise TemplateNotFound(template_id)
    shutil.rmtree(tdir)
