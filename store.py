"""Simple JSON-file storage for image templates.

Each template is a folder under data/templates/<id>/ containing:
  - base.<ext>   the uploaded source image
  - template.json  the template definition (name, canvas size, variables)

No database needed for this tool's scale; template.json is the record.
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
        if v["align"] not in ("left", "center", "right"):
            raise InvalidTemplate(f"Variable '{label}' has invalid align '{v['align']}'")


def create_template(name, image_path, image_ext, width, height, variables):
    validate_variables(variables)
    template_id = uuid.uuid4().hex[:12]
    tdir = _template_dir(template_id)
    os.makedirs(tdir, exist_ok=True)

    dest_image = os.path.join(tdir, f"base{image_ext}")
    # os.replace() requires source and destination on the same filesystem;
    # in containers /tmp is often a separate mount from the app directory,
    # which raises "Invalid cross-device link". shutil.move() falls back
    # to a copy+delete when a same-device rename isn't possible.
    shutil.move(image_path, dest_image)

    record = {
        "id": template_id,
        "name": name or "Untitled template",
        "image_file": f"base{image_ext}",
        "width": width,
        "height": height,
        "variables": variables,
    }
    with open(_template_json_path(template_id), "w") as f:
        json.dump(record, f, indent=2)
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
    return os.path.join(_template_dir(template_id), record["image_file"])


def list_templates():
    out = []
    if not os.path.isdir(TEMPLATES_DIR):
        return out
    for template_id in sorted(os.listdir(TEMPLATES_DIR)):
        path = _template_json_path(template_id)
        if os.path.exists(path):
            with open(path) as f:
                record = json.load(f)
            out.append({
                "id": record["id"],
                "name": record["name"],
                "width": record["width"],
                "height": record["height"],
                "variable_count": len(record["variables"]),
                "labels": [v["label"] for v in record["variables"]],
            })
    return out


def delete_template(template_id):
    tdir = _template_dir(template_id)
    if not os.path.isdir(tdir):
        raise TemplateNotFound(template_id)
    for fname in os.listdir(tdir):
        os.remove(os.path.join(tdir, fname))
    os.rmdir(tdir)
