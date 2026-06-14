#!/usr/bin/env bash
# ============================================================================
# One-shot bootstrap for a fresh AWS EC2 instance (Amazon Linux 2023 or Ubuntu
# 22.04+). Installs Docker + Compose plugin and brings up the platform.
#
# Usage (on the EC2 box, from the repo root after copying it over):
#   chmod +x deploy/aws-ec2-setup.sh
#   ./deploy/aws-ec2-setup.sh
#
# Prereq: backend/.env exists and is filled in (see backend/.env.example).
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Detecting OS..."
. /etc/os-release
echo "    $PRETTY_NAME"

install_docker_amazon() {
  sudo dnf -y update
  sudo dnf -y install docker
  sudo systemctl enable --now docker
  # Compose plugin
  sudo mkdir -p /usr/libexec/docker/cli-plugins
  ARCH="$(uname -m)"
  sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
    -o /usr/libexec/docker/cli-plugins/docker-compose
  sudo chmod +x /usr/libexec/docker/cli-plugins/docker-compose
}

install_docker_ubuntu() {
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo systemctl enable --now docker
}

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker..."
  case "$ID" in
    amzn) install_docker_amazon ;;
    ubuntu|debian) install_docker_ubuntu ;;
    *) echo "Unsupported OS '$ID'. Install Docker + compose plugin manually." ; exit 1 ;;
  esac
  sudo usermod -aG docker "$USER" || true
else
  echo "==> Docker already installed."
fi

if [ ! -f backend/.env ]; then
  echo "!! backend/.env is missing. Copy backend/.env.example to backend/.env and fill it in first."
  exit 1
fi

echo "==> Building and starting the stack..."
sudo docker compose -f docker-compose.prod.yml up -d --build

echo "==> Waiting for backend health..."
for i in $(seq 1 30); do
  if sudo docker compose -f docker-compose.prod.yml exec -T backend curl -fs http://localhost:8000/api/v1/health >/dev/null 2>&1; then
    echo "    backend healthy."
    break
  fi
  sleep 3
done

echo ""
echo "==> Done. App is on http://<EC2_PUBLIC_IP>/  (port 80)"
echo "    Create the first admin (one time):"
echo "      sudo docker compose -f docker-compose.prod.yml exec backend python scripts/create_admin.py"
echo ""
echo "    Logs:    sudo docker compose -f docker-compose.prod.yml logs -f"
echo "    Restart: sudo docker compose -f docker-compose.prod.yml restart"
