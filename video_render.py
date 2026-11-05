"""Burn timed text layers onto a base video with ffmpeg.

Each text layer is drawn with the same fonts as image templates, saved as a
transparent PNG, then shown only between its start and end using ffmpeg's
overlay filter. The source video file is never modified.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw

import render as image_render

_FFMPEG_HELP = "ffmpeg is not installed. On the server run: sudo apt-get install -y ffmpeg"


class VideoRenderError(Exception):
    pass


def ffmpeg_available():
    return shutil.which("ffmpeg") is not None


def _run(cmd):
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except FileNotFoundError as exc:
        raise VideoRenderError(_FFMPEG_HELP) from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "ffmpeg failed").strip().splitlines()
        tail = " ".join(detail[-4:])[:500]
        raise VideoRenderError(tail or "ffmpeg failed")
    return proc


def probe_video(path):
    if not ffmpeg_available():
        raise VideoRenderError(_FFMPEG_HELP)
    if shutil.which("ffprobe"):
        proc = _run([
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", path,
        ])
        try:
            data = json.loads(proc.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise VideoRenderError("Could not read video details.") from exc
        video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
        if not video:
            raise VideoRenderError("The file has no video stream.")
        width = int(video.get("width") or 0)
        height = int(video.get("height") or 0)
        rotation = 0
        tags = video.get("tags") or {}
        try:
            rotation = int(float(tags.get("rotate") or 0))
        except (TypeError, ValueError):
            rotation = 0
        if rotation % 180 != 0:
            width, height = height, width
        duration = 0.0
        for source in (data.get("format") or {}, video):
            try:
                duration = float(source.get("duration") or 0)
            except (TypeError, ValueError):
                duration = 0.0
            if duration > 0:
                break
        if width <= 0 or height <= 0 or duration <= 0:
            raise VideoRenderError("Could not read the video size or duration.")
        has_audio = any(s.get("codec_type") == "audio" for s in data.get("streams", []))
        return width, height, duration, has_audio

    # Fallback to ffmpeg -i when ffprobe is not installed
    proc = subprocess.run(["ffmpeg", "-i", path], capture_output=True, text=True)
    stderr = proc.stderr or ""
    dur_m = re.search(r"Duration:\s*(\d+):(\d+):([\d\.]+)", stderr)
    duration = 0.0
    if dur_m:
        h, m, s = dur_m.groups()
        duration = int(h) * 3600 + int(m) * 60 + float(s)
    vid_m = re.search(r"Stream #.*Video:.*?(\d{2,5})x(\d{2,5})", stderr)
    if not vid_m:
        raise VideoRenderError("The file has no video stream or dimensions could not be read.")
    width = int(vid_m.group(1))
    height = int(vid_m.group(2))
    has_audio = bool(re.search(r"Stream #.*Audio:", stderr))
    if width <= 0 or height <= 0 or duration <= 0:
        raise VideoRenderError("Could not read the video size or duration.")
    return width, height, duration, has_audio


def write_poster(video_path, dest_path):
    _run([
        "ffmpeg", "-y", "-ss", "0", "-i", video_path,
        "-frames:v", "1", "-vf", "scale=640:-2", dest_path,
    ])


def _draw_text(width, height, var, text):
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    image_render.draw_text_variable(overlay, var, text)
    return overlay


def render_video(record, video_path, values):
    """Return mp4 bytes with each text layer visible only from start to end."""
    if not ffmpeg_available():
        raise VideoRenderError(_FFMPEG_HELP)
    width = int(record["width"])
    height = int(record["height"])
    layers = []
    for raw_var in record.get("variables") or []:
        var = dict(raw_var)
        val = values.get(var["label"], var.get("default_text", ""))
        if isinstance(val, dict):
            text = str(val.get("text", val.get("value", var.get("default_text", ""))))
            var.update(val)
        else:
            text = str(val)
        if text == "":
            continue
        start = float(var.get("start") or 0)
        end = float(var.get("end") or 0)
        if end <= start:
            continue
        layers.append((var, text, start, end))

    tmp = tempfile.mkdtemp(prefix="vidtpl-")
    out_path = os.path.join(tmp, "out.mp4")
    try:
        cmd = ["ffmpeg", "-y", "-i", video_path]
        filter_parts = []
        prev = "0:v"
        for index, (var, text, start, end) in enumerate(layers):
            png_path = os.path.join(tmp, f"text{index}.png")
            _draw_text(width, height, var, text).save(png_path, format="PNG")
            cmd += ["-loop", "1", "-i", png_path]
            dest = f"v{index}"
            filter_parts.append(
                f"[{prev}][{index + 1}:v]overlay=0:0:format=auto:"
                f"enable='between(t,{start:.3f},{end:.3f})'[{dest}]"
            )
            prev = dest
        if filter_parts:
            cmd += ["-filter_complex", ";".join(filter_parts), "-map", f"[{prev}]"]
        else:
            cmd += ["-map", "0:v"]
        if record.get("has_audio"):
            cmd += ["-map", "0:a", "-c:a", "aac", "-b:a", "128k"]
        else:
            cmd += ["-an"]
        cmd += [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            "-t", f"{float(record['duration']):.3f}",
            out_path,
        ]
        _run(cmd)
        with open(out_path, "rb") as handle:
            return handle.read()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
