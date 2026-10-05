"""Renders a template + variable text values into a final PNG/JPEG image."""
import io
import json
import os

from PIL import Image, ImageDraw, ImageFont

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FONTS_DIR = os.path.join(BASE_DIR, "static", "fonts")
FONTS_MANIFEST_PATH = os.path.join(FONTS_DIR, "fonts.json")

_font_cache = {}
_manifest_cache = None


def _slug_from_manifest_name(name):
    """Best-effort: manifest stores {name, file}; 'file' is the slug we need."""
    return os.path.splitext(name)[0]


def load_font_manifest():
    global _manifest_cache
    if _manifest_cache is None:
        with open(FONTS_MANIFEST_PATH) as f:
            _manifest_cache = json.load(f)
    return _manifest_cache


def _resolve_font_file(font_key):
    """font_key may be a manifest 'file' value (e.g. 'roboto.ttf') or a slug
    ('roboto'). Falls back to Roboto if unknown."""
    manifest = load_font_manifest()
    files = {m["file"] for m in manifest}
    candidates = [font_key, f"{font_key}.ttf"]
    for c in candidates:
        if c in files:
            return c
    return "roboto.ttf"


def get_font(font_key, size):
    filename = _resolve_font_file(font_key)
    cache_key = (filename, size)
    if cache_key not in _font_cache:
        path = os.path.join(FONTS_DIR, filename)
        _font_cache[cache_key] = ImageFont.truetype(path, size=max(1, int(size)))
    return _font_cache[cache_key]


def _wrap_text(draw, text, font, max_width):
    """Greedy word-wrap; also breaks a single overlong word by character."""
    if max_width is None or max_width <= 0:
        return text.split("\n")

    lines = []
    for paragraph in text.split("\n"):
        words = paragraph.split(" ")
        current = ""
        for word in words:
            trial = (current + " " + word).strip()
            if draw.textlength(trial, font=font) <= max_width or not current:
                current = trial
            else:
                lines.append(current)
                current = word
            # break an overlong single word by characters
            while draw.textlength(current, font=font) > max_width and len(current) > 1:
                lo, hi = 1, len(current)
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if draw.textlength(current[:mid], font=font) <= max_width:
                        lo = mid
                    else:
                        hi = mid - 1
                lines.append(current[:lo])
                current = current[lo:]
        lines.append(current)
    return lines


def render_template(record, image_source, values, output_format="PNG"):
    """
    record: template dict (from store.get_template)
    image_source: filesystem path to the base image
    values: dict {label: text}
    Returns: (bytes, mimetype)
    """
    base = Image.open(image_source).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for var in record["variables"]:
        label = var["label"]
        text = str(values.get(label, var.get("default_text", "")))
        if text == "":
            continue

        font = get_font(var.get("font", "roboto"), var["font_size"])
        color = var.get("color", "#000000")
        align = var.get("align", "left")
        max_width = var.get("width")
        line_height_mult = var.get("line_height", 1.2)

        lines = _wrap_text(draw, text, font, max_width)

        ascent, descent = font.getmetrics()
        line_height = int((ascent + descent) * line_height_mult)

        x0, y0 = var["x"], var["y"]
        for i, line in enumerate(lines):
            line_width = draw.textlength(line, font=font)
            if align == "center":
                lx = x0 + ((max_width or line_width) - line_width) / 2
            elif align == "right":
                lx = x0 + (max_width or line_width) - line_width
            else:
                lx = x0
            ly = y0 + i * line_height
            draw.text((lx, ly), line, font=font, fill=color)

    result = Image.alpha_composite(base, overlay)

    buf = io.BytesIO()
    fmt = output_format.upper()
    if fmt in ("JPG", "JPEG"):
        result = result.convert("RGB")
        result.save(buf, format="JPEG", quality=92)
        mimetype = "image/jpeg"
    else:
        result.save(buf, format="PNG")
        mimetype = "image/png"
    buf.seek(0)
    return buf.getvalue(), mimetype
