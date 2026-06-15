#!/usr/bin/env bash
# Build locally and push artifacts to the EC2 box over SSH — NO git on the server.
# Run from the repo root on your laptop (WSL/Git Bash/mac).
#
#   KEY=~/dev-invest.pem ./deploy/deploy-from-laptop.sh
#
# Override HOST / REMOTE if different:
#   KEY=~/key.pem HOST=ubuntu@15.207.97.16 ./deploy/deploy-from-laptop.sh
set -euo pipefail

KEY="${KEY:?Set KEY=/path/to/your-ec2-key.pem}"
HOST="${HOST:-ubuntu@15.207.97.16}"
REMOTE="${REMOTE:-/home/ubuntu/AI_Investment_Intelligence_Platform/AI_Investment_Intelligence_Platform}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

echo "==> 1/4 Building frontend locally"
( cd frontend && npm install && npm run build )

echo "==> 2/4 Uploading backend code (keeps server .env / .venv / db untouched)"
rsync -avz --delete -e "$SSH" \
  --exclude '.git' --exclude '.venv' --exclude '__pycache__' \
  --exclude '*.env' --exclude '*.db' --exclude 'audit.log*' \
  backend "$HOST:$REMOTE/"

echo "==> 3/4 Uploading built frontend"
rsync -avz --delete -e "$SSH" frontend/dist/ "$HOST:$REMOTE/frontend/dist/"

echo "==> 4/4 Restarting backend + publishing frontend"
$SSH "$HOST" bash -lc "
  set -e
  cd '$REMOTE/backend'
  ./.venv/bin/pip install -q -r requirements.txt
  sudo kill \$(sudo ss -ltnp 'sport = :8000' | grep -oP 'pid=\K[0-9]+' | head -1) 2>/dev/null || true
  sleep 1
  nohup ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 > ~/backend.log 2>&1 &
  sudo cp -r '$REMOTE/frontend/dist/'* /var/www/broking-ai/
  echo 'restarted + published'
"
echo "==> Done: https://dev-invest.niytri.com"
