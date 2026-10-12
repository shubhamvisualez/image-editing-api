#!/usr/bin/env bash
# Install the image template tool next to the existing ai_assistant service.
# Run from anywhere, as the app user (not root):
#   bash deploy/install.sh
# The script uses sudo only to register the systemd unit.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="$(whoami)"
UNIT_NAME="image_editor.service"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this as the app user (shubham_visualez), not root."
  exit 1
fi

cd "$APP_DIR"

if ! command -v python3 >/dev/null; then
  echo "python3 is required."
  exit 1
fi

if [[ ! -d venv ]]; then
  python3 -m venv venv
fi
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

if ! compgen -G "static/fonts/*.ttf" > /dev/null; then
  ./venv/bin/python scripts/download_fonts.py
fi

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  echo "Video templates need ffmpeg. Install it with: sudo apt-get install -y ffmpeg"
fi

if [[ ! -f .env ]]; then
  sed -e 's|^# URL_PREFIX=/image-editor|URL_PREFIX=/image-editor|' \
      .env.example > .env
  chmod 600 .env
fi

UNIT_TMP="$(mktemp)"
sed -e "s|__APP_USER__|$APP_USER|g" -e "s|__APP_DIR__|$APP_DIR|g" \
  deploy/image_editor.service > "$UNIT_TMP"

sudo cp "$UNIT_TMP" "/etc/systemd/system/$UNIT_NAME"
rm -f "$UNIT_TMP"
sudo systemctl daemon-reload
sudo systemctl enable "$UNIT_NAME"
sudo systemctl restart "$UNIT_NAME"
sudo systemctl --no-pager --full status "$UNIT_NAME" || true

cat <<EOF

Service is on 127.0.0.1:8010. ai_assistant.service was not changed.

Gunicorn is only on 127.0.0.1:8010. Apache still serves
public_html/image-editor as a folder, which returns 403 until you proxy it.
The service name is apache2, not apache:

  bash deploy/enable-apache.sh

Public URL: https://<your-domain>/image-editor/
Health check on the box: curl -s http://127.0.0.1:8010/healthz

EOF
