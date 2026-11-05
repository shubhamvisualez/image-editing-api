#!/usr/bin/env bash
# Point https://<domain>/image-editor/ at the local gunicorn service.
# Run on the server: bash deploy/enable-apache.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF_NAME="image-editor"
DEST="/etc/apache2/conf-available/${CONF_NAME}.conf"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as shubham_visualez. The script will sudo for Apache."
  exit 1
fi

sudo a2enmod proxy proxy_http headers
sudo cp "$APP_DIR/deploy/apache-image-editor.conf" "$DEST"
sudo a2enconf "$CONF_NAME"
sudo apache2ctl configtest
sudo systemctl reload apache2

if [[ -f "$APP_DIR/.env" ]] && ! grep -q '^URL_PREFIX=' "$APP_DIR/.env"; then
  echo 'URL_PREFIX=/image-editor' >> "$APP_DIR/.env"
  sudo systemctl restart image_editor
fi

echo
echo "Apache reloaded. Checking the public URL from this machine:"
curl -sk -o /dev/null -w "HTTP %{http_code}\n" \
  --resolve quicklook.orientbell.com:443:127.0.0.1 \
  https://quicklook.orientbell.com/image-editor/ || true
echo "If that is not 200, the last Apache errors are:"
sudo tail -n 20 /var/log/apache2/error.log || true
