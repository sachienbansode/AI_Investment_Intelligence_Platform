#!/usr/bin/env bash
# Pull latest code on the EC2 box and redeploy (no Docker).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo "==> git pull"
git pull --ff-only
echo "==> backend deps + restart"
cd backend && ./.venv/bin/pip install -q -r requirements.txt
sudo systemctl restart broking-backend
echo "==> frontend build + publish"
cd ../frontend && npm install --silent && npm run build
sudo cp -r dist/* /var/www/broking-ai/
echo "==> done: https://dev-invest.niytri.com"
