# Image Template Tool

Design an image once — a poster, a certificate, a social card — with
positioned text variables (label, font, size, color, alignment), then
generate finished images by POSTing text values to an API.

## Setup

```bash
cd image-template-tool
pip3 install -r requirements.txt
python3 scripts/download_fonts.py   # one-time: fetches the font library into static/fonts/
python3 app.py                      # serves on http://localhost:8000
```

## Using it

1. **Templates** (`/`) — lists every saved template with a thumbnail.
2. **New Template** (`/new`) — upload a base image, click "+ Add Text
   Variable" for each piece of text you want to be able to fill in later,
   then for each one:
   - **Label** — the key used later in the API (letters/numbers/underscore,
     must start with a letter, unique per template).
   - **Default / sample text** — shown in the editor and used if the API
     call omits that variable.
   - **Font, size, color, alignment.**
   - Drag the box to position it; drag the bottom-right handle to change
     its wrap width (text longer than the box wraps to multiple lines).
3. **Edit** (`/templates/<id>/edit`) — reopen a saved template to adjust
   variables (the base image itself can't be replaced — create a new
   template for a different image).
4. **Test / API** (`/templates/<id>/preview`) — fill in sample values and
   render in the browser; the page also shows the exact `curl` command and
   JSON body for the API.

## API

### Render an image — simple URL

The shortest way to get an image: `GET` the template id with each variable's
label as a query parameter. Drop it straight into an `<img src>`, an email,
or a no-code tool.

```
http://localhost:8000/<id>?headline=BIG+SALE&subtext=Up+to+50%25+off
```

```html
<img src="http://localhost:8000/<id>?headline=BIG+SALE&subtext=Up+to+50%25+off">
```

Add `&format=jpg` for JPEG. Missing labels fall back to that variable's
default text. Because values ride in the URL (and so end up in server/proxy
logs and browser history), prefer the JSON form below for sensitive text.

The same query-param form also works at `/api/templates/<id>/render` (e.g.
if you'd rather keep everything under `/api/`).

### Render an image — JSON (POST)

```bash
curl -X POST "http://localhost:8000/api/templates/<id>/render" \
  -H "Content-Type: application/json" \
  -d '{"values": {"headline": "BIG SALE", "subtext": "Up to 50% off"}, "format": "png"}' \
  --output result.png
```

- `values` — object mapping each variable's label to the text to draw.
  Missing labels fall back to that variable's default text.
- `format` — `png` (default, supports transparency) or `jpg`.
- Response is the raw image bytes (`image/png` or `image/jpeg`) on success,
  or `{"error": "..."}` with a 4xx/5xx status on failure.

### Manage templates

| Method  | Path                        | Purpose                                  |
|---------|------------------------------|-------------------------------------------|
| GET     | `/<id>`                      | Render (query params = variable values, `&format=`) |
| GET     | `/api/templates`             | List templates (id, name, size, labels)   |
| POST    | `/api/templates`             | Create (multipart: `image`, `name`, `variables` JSON) |
| GET     | `/api/templates/<id>`        | Full template definition                  |
| PUT     | `/api/templates/<id>`        | Update `name` and/or `variables` (JSON)   |
| DELETE  | `/api/templates/<id>`        | Delete a template and its image           |
| GET/POST| `/api/templates/<id>/render` | Render (GET: query params; POST: JSON body) |
| GET     | `/api/fonts`                 | List available fonts (`{name, file}`)     |

Each variable object: `{label, x, y, width, font_size, color, align, font,
default_text, line_height}`. `x`/`y`/`width`/`font_size` are pixels in the
original uploaded image's resolution; `font` is a filename from
`/api/fonts` (with or without the `.ttf` extension).

## Fonts

`static/fonts/` ships ~40 open-license (OFL/Apache) Google Fonts covering
sans, serif, display, script, and monospace styles — enough variety for
most poster/card/badge use cases without needing internet access at
render time. Re-run `scripts/download_fonts.py` to refresh or extend the
set (edit `FONT_FAMILIES` in that script to add more).

## Video templates

Image templates are unchanged. Videos are a separate library at `/videos`.

Upload a base video, place text on the frame, and drag each layer’s bar on the timeline to set when it appears and how long it stays — the same idea as a [Pirsonal](https://pirsonal.com/platform/pirsonal-editor/) text layer (a start time and a duration). Rendering burns that text into an mp4 with ffmpeg. The server needs `ffmpeg` and `ffprobe` (`sudo apt-get install -y ffmpeg`).

Set the template up in the browser at `/videos/new` (on the server:
`https://quicklook.orientbell.com/image-editor/videos/new`). Save it, open
Test / API, and copy the template id.

The render call matches Pirsonal’s JSON-RPC method `Template_Video_New`
([Pirsonal API](https://app.pirsonal.com/docAPI)). `data` is the text for
each layer. Keys may be `headline` or `$headline`. The response is ready
immediately: `result.url` is the mp4. `Video_Get` loads that same object
again, and `Template_List` lists templates.

```bash
curl -X POST "http://localhost:8000/api" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"Template_Video_New","params":{"templateID":"<id>","name":"Hello","description":"","data":{"headline":"Ada"}}}'
```

A shorter form is `http://localhost:8000/v/<id>?headline=Ada`. Timing lives on the template; the API only replaces the text. Video files are stored under `data/videos/<id>/`.

Gunicorn’s timeout in `deploy/image_editor.service` is 300 seconds so a render can finish. If the service was installed earlier, update that unit and run `sudo systemctl daemon-reload && sudo systemctl restart image_editor`.

## Storage

Each template is a folder under `data/templates/<id>/`: the uploaded base
image (`base.png`, `base.jpg`, or `base.webp`) plus `template.json`. No
database and no S3. On the EC2 box that directory stays on disk across
restarts.

Leave `URL_PREFIX` unset when you run `python app.py` directly. The install
script sets `URL_PREFIX=/image-editor` in `.env` so Apache can mount the app
under that path.

## Deploy on the existing Apache EC2

The box already runs `ai_assistant.service` (Gunicorn + FastAPI). This app
is a second service on **127.0.0.1:8010**. Apache proxies `/image-editor/`
to it. Do not restart or edit `ai_assistant`.

On the server, as `shubham_visualez`, from the app directory:

```bash
bash deploy/install.sh
```

Then check the service:

```bash
curl -s http://127.0.0.1:8010/healthz
```

`image_storage` should be `"local"`. The app folder sits inside
`public_html`, so Apache returns 403 for `/image-editor/` until the proxy
is enabled. The unit name is `apache2`:

```bash
bash deploy/enable-apache.sh
```

The site is then `https://<your-domain>/image-editor/`.
API calls use that prefix, for example
`https://<your-domain>/image-editor/<id>?headline=Hello`.

**On Render's free plan there is no persistent disk** — every deploy or
restart wipes `data/templates/`, so templates created there won't survive.
For anything long-lived, use the EC2 install above.
