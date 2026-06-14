#!/usr/bin/env bash
# ============================================================================
# Bare-metal deploy (NO Docker) for a fresh EC2 instance:
#   • Python venv + uvicorn backend behind a systemd service
#   • React build served by nginx, which reverse-proxies /api → backend
#   • Free Let's Encrypt SSL via certbot (auto-renewing)
#
# Supports Amazon Linux 2023 and Ubuntu 22.04+.
#
# Run from the repo root after cloning:
#   chmod +x deploy/setup-ec2-no-docker.sh
#   DOMAIN=dev-invest.niytri.com EMAIL=you@niytri.com ./deploy/setup-ec2-no-docker.sh
#
# Prereqs (do these first):
#   • backend/.env filled in (DATABASE_URL, JWT_SECRET, LLM keys,
#     CORS_ORIGINS=https://dev-invest.niytri.com)
#   • DNS A record  dev-invest.niytri.com → this server's Elastic IP
#   • Security group: inbound 80 and 443 open; 22 from your IP
# ============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-dev-invest.niytri.com}"
EMAIL="${EMAIL:-}"
APP_USER="$(whoami)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="/var/www/broking-ai"
cd "$REPO_ROOT"

. /etc/os-release
echo "==> OS: $PRETTY_NAME | domain: $DOMAIN | repo: $REPO_ROOT | user: $APP_USER"

if [ ! -f backend/.env ]; then
  echo "!! backend/.env is missing. Copy backend/.env.example to backend/.env and fill it in first."
  exit 1
fi

# ── 1. System packages ──────────────────────────────────────────
echo "==> Installing system packages (python, node, nginx, certbot)..."
case "$ID" in
  amzn)
    sudo dnf -y install python3.11 python3.11-pip nginx certbot python3-certbot-nginx gcc python3.11-devel libpq-devel curl
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf -y install nodejs
    PYBIN=python3.11
    ;;
  ubuntu|debian)
    sudo apt-get update
    sudo apt-get install -y python3 python3-venv python3-pip nginx certbot python3-certbot-nginx build-essential libpq-dev curl
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
    sudo apt-get install -y nodejs
    PYBIN=python3
    ;;
  *) echo "Unsupported OS '$ID'."; exit 1 ;;
esac

# ── 2. Backend: venv + dependencies ─────────────────────────────
echo "==> Setting up backend venv..."
cd "$REPO_ROOT/backend"
$PYBIN -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt

# ── 3. Frontend: build + publish ────────────────────────────────
echo "==> Building frontend..."
cd "$REPO_ROOT/frontend"
npm install
npm run build
sudo mkdir -p "$WEB_ROOT"
sudo cp -r dist/* "$WEB_ROOT/"

# ── 4. systemd service for the backend ──────────────────────────
echo "==> Installing systemd service..."
sudo tee /etc/systemd/system/broking-backend.service >/dev/null <<UNIT
[Unit]
Description=AI Investment Intelligence Platform - FastAPI backend
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_ROOT/backend
ExecStart=$REPO_ROOT/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now broking-backend

# ── 5. nginx site ───────────────────────────────────────────────
echo "==> Configuring nginx..."
NGINX_CONF=$(mktemp)
sed "s/dev-invest.niytri.com/$DOMAIN/g" "$REPO_ROOT/deploy/nginx-broking.conf" > "$NGINX_CONF"
if [ -d /etc/nginx/sites-available ]; then
  sudo cp "$NGINX_CONF" /etc/nginx/sites-available/broking.conf
  sudo ln -sf /etc/nginx/sites-available/broking.conf /etc/nginx/sites-enabled/broking.conf
  sudo rm -f /etc/nginx/sites-enabled/default
else
  sudo cp "$NGINX_CONF" /etc/nginx/conf.d/broking.conf
fi
rm -f "$NGINX_CONF"

# SELinux (Amazon Linux): allow nginx to proxy to the backend
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  sudo setsebool -P httpd_can_network_connect 1 || true
fi

sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

# ── 6. SSL via certbot ──────────────────────────────────────────
echo "==> Requesting Let's Encrypt certificate for $DOMAIN..."
if [ -n "$EMAIL" ]; then
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
    echo "!! certbot failed — check DNS resolves to this server and 80/443 are open, then run: sudo certbot --nginx -d $DOMAIN"
else
  echo "!! EMAIL not set — skipping automatic SSL. Run manually: sudo certbot --nginx -d $DOMAIN"
fi

echo ""
echo "==> Done."
echo "    Backend:  systemctl status broking-backend"
echo "    Logs:     journalctl -u broking-backend -f"
echo "    Health:   curl -s http://127.0.0.1:8000/api/v1/health"
echo "    Create first admin (one time):"
echo "      cd $REPO_ROOT/backend && ./.venv/bin/python scripts/create_admin.py"
echo "    App URL:  https://$DOMAIN"
