"""Renders a template + variable text values into a final PNG/JPEG image."""
import io
import json
import math
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
        with open(FONTS_MANIFEST_PATH, encoding="utf-8") as f:
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


def get_font(font_key, size, bold=False):
    """Return (font, is_variable_bold). If font is a variable font with a Weight axis,
    bold=True sets the variation axis directly."""
    filename = _resolve_font_file(font_key)
    cache_key = (filename, max(1, int(size)), bool(bold))
    if cache_key not in _font_cache:
        path = os.path.join(FONTS_DIR, filename)
        font = ImageFont.truetype(path, size=max(1, int(size)))
        is_variable_bold = False
        if bold:
            try:
                axes = font.get_variation_axes() if hasattr(font, "get_variation_axes") else []
                for ax in axes:
                    if ax.get("name") in (b"Weight", "Weight"):
                        font.set_variation_by_axes([700] + [a["default"] for a in axes[1:]])
                        is_variable_bold = True
                        break
            except Exception:
                pass
            if not is_variable_bold:
                try:
                    names = font.get_variation_names() if hasattr(font, "get_variation_names") else []
                    for name in names:
                        if b"Bold" in name and b"Extra" not in name and b"Semi" not in name:
                            font.set_variation_by_name(name)
                            is_variable_bold = True
                            break
                except Exception:
                    pass
        _font_cache[cache_key] = (font, is_variable_bold)
    return _font_cache[cache_key]


def hex_to_rgba(hex_str, opacity=1.0):
    if not hex_str:
        return None
    s = str(hex_str).strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return None
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        a = int(round(255 * max(0.0, min(1.0, float(opacity)))))
        return (r, g, b, a)
    except Exception:
        return None


def measure_text_length(draw, text, font, letter_spacing=0, stroke_width=0):
    if not text:
        return 0
    if not letter_spacing:
        w = draw.textlength(text, font=font)
    else:
        w = sum(draw.textlength(c, font=font) for c in text) + max(0, len(text) - 1) * letter_spacing
    if stroke_width > 0:
        w += stroke_width
    return w


def _wrap_text(draw, text, font, max_width, letter_spacing=0, stroke_width=0):
    """Greedy word-wrap; also breaks a single overlong word by character."""
    if max_width is None or max_width <= 0:
        return text.split("\n")

    lines = []
    for paragraph in text.split("\n"):
        words = paragraph.split(" ")
        current = ""
        for word in words:
            trial = (current + " " + word).strip()
            if measure_text_length(draw, trial, font=font, letter_spacing=letter_spacing, stroke_width=stroke_width) <= max_width or not current:
                current = trial
            else:
                lines.append(current)
                current = word
            # break an overlong single word by characters
            while measure_text_length(draw, current, font=font, letter_spacing=letter_spacing, stroke_width=stroke_width) > max_width and len(current) > 1:
                lo, hi = 1, len(current)
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if measure_text_length(draw, current[:mid], font=font, letter_spacing=letter_spacing, stroke_width=stroke_width) <= max_width:
                        lo = mid
                    else:
                        hi = mid - 1
                lines.append(current[:lo])
                current = current[lo:]
        lines.append(current)
    return lines


def _draw_char_line(draw, text, x, y, font, fill_color, stroke_color, stroke_width, letter_spacing):
    """Draw a single line of text with optional per-character letter spacing and outline stroke."""
    if not letter_spacing:
        kwargs = {"fill": fill_color}
        if stroke_color and stroke_width > 0:
            kwargs["stroke_fill"] = stroke_color
            kwargs["stroke_width"] = stroke_width
        draw.text((x, y), text, font=font, **kwargs)
    else:
        cx = x
        for char in text:
            kwargs = {"fill": fill_color}
            if stroke_color and stroke_width > 0:
                kwargs["stroke_fill"] = stroke_color
                kwargs["stroke_width"] = stroke_width
            draw.text((cx, y), char, font=font, **kwargs)
            cx += draw.textlength(char, font=font) + letter_spacing


def draw_text_variable(overlay, var, text):
    """Draw a single styled text variable onto the RGBA overlay image."""
    if text is None:
        text = ""
    text = str(text)
    if not text:
        return

    # Extract variable properties
    bold = bool(var.get("bold", False))
    italic = bool(var.get("italic", False))
    underline = bool(var.get("underline", False))
    strikethrough = bool(var.get("strikethrough", False))
    uppercase = bool(var.get("uppercase", False))
    letter_spacing = float(var.get("letter_spacing") or 0)
    line_height_mult = float(var.get("line_height") or 1.2)
    align = var.get("align", "left")
    font_size = max(1, int(round(float(var.get("font_size", 24)))))
    font_key = var.get("font", "roboto")
    color = var.get("color", "#000000")
    bg_color = var.get("bg_color", "")
    stroke_color = var.get("stroke_color", "")
    stroke_width = max(0, int(round(float(var.get("stroke_width") or 0))))
    opacity = max(0.0, min(1.0, float(var.get("opacity") if var.get("opacity") is not None else 1.0)))

    x0 = int(round(float(var["x"])))
    y0 = int(round(float(var["y"])))
    max_width = int(round(float(var["width"]))) if var.get("width") else None

    if uppercase:
        text = text.upper()

    font, is_variable_bold = get_font(font_key, font_size, bold=bold)
    faux_bold = max(1, int(round(font_size * 0.035))) if (bold and not is_variable_bold) else 0

    fill_rgba = hex_to_rgba(color, opacity) or (0, 0, 0, int(round(255 * opacity)))
    bg_rgba = hex_to_rgba(bg_color, opacity) if bg_color else None
    stroke_rgba = hex_to_rgba(stroke_color, opacity) if (stroke_color and stroke_width > 0) else None

    if stroke_rgba and stroke_width > 0:
        draw_stroke_width = stroke_width + faux_bold
        draw_stroke_fill = stroke_rgba
    elif faux_bold > 0:
        draw_stroke_width = faux_bold
        draw_stroke_fill = fill_rgba
    else:
        draw_stroke_width = 0
        draw_stroke_fill = None

    overlay_draw = ImageDraw.Draw(overlay)
    lines = _wrap_text(
        overlay_draw,
        text,
        font,
        max_width,
        letter_spacing=letter_spacing,
        stroke_width=draw_stroke_width,
    )

    ascent, descent = font.getmetrics()
    line_height = int((ascent + descent) * line_height_mult)

    # Pre-calculate line dimensions and positions
    line_layout = []
    min_x = x0
    max_x = x0
    for i, line in enumerate(lines):
        line_w = measure_text_length(
            overlay_draw,
            line,
            font,
            letter_spacing=letter_spacing,
            stroke_width=draw_stroke_width,
        )
        if align == "center":
            lx = x0 + ((max_width or line_w) - line_w) / 2
        elif align == "right":
            lx = x0 + (max_width or line_w) - line_w
        else:
            lx = x0
        ly = y0 + i * line_height
        rx = lx + line_w
        min_x = min(min_x, lx)
        max_x = max(max_x, rx)
        line_layout.append((line, lx, ly, line_w))

    # Draw background highlight pill/rectangle for each line if requested
    if bg_rgba:
        pad_x = max(4, int(round(font_size * 0.22)))
        pad_y = max(2, int(round(font_size * 0.12)))
        radius = max(3, int(round(font_size * 0.15)))
        for line, lx, ly, line_w in line_layout:
            if not line:
                continue
            box_rect = [
                lx - pad_x,
                ly - pad_y,
                lx + line_w + pad_x,
                ly + line_height - pad_y,
            ]
            overlay_draw.rounded_rectangle(box_rect, radius=radius, fill=bg_rgba)

    # Standard (non-italic) rendering
    if not italic:
        line_thick = max(1, int(round(font_size * 0.06)))
        for line, lx, ly, line_w in line_layout:
            _draw_char_line(
                overlay_draw,
                line,
                lx,
                ly,
                font,
                fill_rgba,
                draw_stroke_fill,
                draw_stroke_width,
                letter_spacing,
            )
            if underline:
                uy = ly + ascent + max(2, int(round(font_size * 0.08)))
                overlay_draw.line([(lx, uy), (lx + line_w, uy)], fill=fill_rgba, width=line_thick)
            if strikethrough:
                sy = ly + int(ascent * 0.6)
                overlay_draw.line([(lx, sy), (lx + line_w, sy)], fill=fill_rgba, width=line_thick)
    else:
        # Italic rendering: render lines to temporary transparent layer and shear with affine transform
        total_h = len(lines) * line_height
        box_w = int(math.ceil(max(10, max_x - min_x)))
        box_h = int(math.ceil(max(10, total_h + font_size * 0.5)))
        pad = int(math.ceil(font_size * 0.8))

        layer_w = box_w + pad * 2
        layer_h = box_h + pad * 2
        text_layer = Image.new("RGBA", (layer_w, layer_h), (0, 0, 0, 0))
        layer_draw = ImageDraw.Draw(text_layer)

        line_thick = max(1, int(round(font_size * 0.06)))
        for line, lx, ly, line_w in line_layout:
            local_x = lx - min_x + pad
            local_y = ly - y0 + pad
            _draw_char_line(
                layer_draw,
                line,
                local_x,
                local_y,
                font,
                fill_rgba,
                draw_stroke_fill,
                draw_stroke_width,
                letter_spacing,
            )
            if underline:
                uy = local_y + ascent + max(2, int(round(font_size * 0.08)))
                layer_draw.line([(local_x, uy), (local_x + line_w, uy)], fill=fill_rgba, width=line_thick)
            if strikethrough:
                sy = local_y + int(ascent * 0.6)
                layer_draw.line([(local_x, sy), (local_x + line_w, sy)], fill=fill_rgba, width=line_thick)

        s = math.tan(math.radians(12))  # ~0.212 shear angle
        extra_w = int(math.ceil(layer_h * s))
        y_anchor = layer_h - pad
        sheared_layer = text_layer.transform(
            (layer_w + extra_w, layer_h),
            Image.AFFINE,
            (1, s, -s * y_anchor, 0, 1, 0),
            resample=Image.BICUBIC,
        )
        dest_x = int(round(min_x - pad))
        dest_y = int(round(y0 - pad))
        overlay.paste(sheared_layer, (dest_x, dest_y), sheared_layer)


def render_template(record, image_source, values, output_format="PNG"):
    """
    record: template dict (from store.get_template)
    image_source: filesystem path to the base image
    values: dict {label: text} or {label: {text: ..., ...}}
    Returns: (bytes, mimetype)
    """
    base = Image.open(image_source).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))

    for raw_var in record["variables"]:
        var = dict(raw_var)
        label = var["label"]
        val = values.get(label, var.get("default_text", ""))
        if isinstance(val, dict):
            text = str(val.get("text", val.get("value", var.get("default_text", ""))))
            var.update(val)
        else:
            text = str(val)

        if text == "":
            continue

        draw_text_variable(overlay, var, text)

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
