#!/usr/bin/env bash
set -euo pipefail

# Git repo URL for ProcessorCluster project
GIT_REPO_URL="https://github.com/bsturdy/ProcessingCluster.git"

# Directory to clone into (or update if it already exists)
BASE_DIR="$HOME/ProcessingCluster"

# Worker ID (if empty, we'll default to "worker-<hostname>")
WORKER_ID="${1:-}"

# Worker HTTP port
WORKER_PORT=9000

# Max concurrent jobs on this worker
MAX_CONCURRENT_JOBS=8


echo "[setup] Starting worker setup..."

if [[ -z "$WORKER_ID" ]]; then
  HOSTNAME="$(hostname)"
  WORKER_ID="worker-${HOSTNAME}"
fi

echo "[setup] Using worker_id=${WORKER_ID}"
echo "[setup] Using base directory ${BASE_DIR}"

CURRENT_USER="$(whoami)"
echo "[setup] Running as user ${CURRENT_USER}"

### 1. Update apt and install dependencies #####################################

echo "[setup] Updating apt and installing dependencies (git, curl, nodejs, npm, docker.io)..."

sudo apt update -y
sudo apt install -y git curl nodejs npm docker.io

### 2. Ensure current user is in docker group ##################################

if ! groups "${CURRENT_USER}" | grep -q '\bdocker\b'; then
  echo "[setup] Adding user '${CURRENT_USER}' to 'docker' group (you must log out and back in after this)."
  sudo usermod -aG docker "${CURRENT_USER}"
else
  echo "[setup] User '${CURRENT_USER}' is already in docker group."
fi

### 3. Clone or update the repo ###############################################

if [[ -d "${BASE_DIR}/.git" ]]; then
  echo "[setup] Repo already exists at ${BASE_DIR}, pulling latest..."
  cd "${BASE_DIR}"
  git pull --ff-only || echo "[setup] git pull failed; check manually."
else
  echo "[setup] Cloning repo into ${BASE_DIR}..."
  git clone "${GIT_REPO_URL}" "${BASE_DIR}"
  cd "${BASE_DIR}"
fi

### 4. Go to worker-agent/node #################################################

WORKER_NODE_DIR="${BASE_DIR}/worker-agent/node"
echo "[setup] Using worker node directory: ${WORKER_NODE_DIR}"

mkdir -p "${WORKER_NODE_DIR}"
cd "${WORKER_NODE_DIR}"

### 5. Ensure package.json exists and is ES module #############################

if [[ ! -f "package.json" ]]; then
  echo "[setup] Creating minimal package.json..."
  cat > package.json <<EOF
{
  "name": "worker-agent",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "express": "^4.21.2",
    "js-yaml": "^4.1.0",
    "cors": "^2.8.5"
  }
}
EOF
else
  echo "[setup] package.json already exists."
  echo "[setup] Please ensure it contains \"type\": \"module\" at the top level."
fi

### 6. Install node dependencies ##############################################

echo "[setup] Running npm install..."
npm install

# Ensure cors is present even if package.json pre-existed
echo "[setup] Ensuring 'cors' dependency is installed..."
npm install cors --save

### 7. Create config/worker-default.yaml if missing ###########################

CONFIG_DIR="${WORKER_NODE_DIR}/config"
CONFIG_FILE="${CONFIG_DIR}/worker-default.yaml"

mkdir -p "${CONFIG_DIR}"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "[setup] Creating ${CONFIG_FILE}..."
  cat > "${CONFIG_FILE}" <<EOF
worker_id: "${WORKER_ID}"
port: ${WORKER_PORT}
max_concurrent_jobs: ${MAX_CONCURRENT_JOBS}
labels:
  - "ubuntu"
  - "$(hostname)"
EOF
else
  echo "[setup] ${CONFIG_FILE} already exists; not overwriting."
fi

### 8. Create systemd service for autostart ###################################

SERVICE_NAME="processor-worker-${WORKER_ID}.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"

echo "[setup] Creating systemd service ${SERVICE_NAME}..."

SERVICE_CONTENT="[Unit]
Description=ProcessorCluster Worker (${WORKER_ID})
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${WORKER_NODE_DIR}
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
"

echo "${SERVICE_CONTENT}" | sudo tee "${SERVICE_PATH}" > /dev/null

echo "[setup] Reloading systemd daemon..."
sudo systemctl daemon-reload

echo "[setup] Enabling service ${SERVICE_NAME} to start on boot..."
sudo systemctl enable "${SERVICE_NAME}"

echo "[setup] Starting service ${SERVICE_NAME} now..."
sudo systemctl restart "${SERVICE_NAME}" || sudo systemctl start "${SERVICE_NAME}"

### 9. Summary #################################################################

echo
echo "[setup] Worker setup complete."
echo "[setup] Repo directory: ${BASE_DIR}"
echo "[setup] Worker node directory: ${WORKER_NODE_DIR}"
echo "[setup] Config file: ${CONFIG_FILE}"
echo "[setup] Systemd service: ${SERVICE_PATH}"
echo
echo "[setup] IMPORTANT:"
echo "  - If this is the first time you were added to the 'docker' group,"
echo "    you must log out and log back in (or reboot) before Docker works for you interactively."
echo "  - The service runs as user '${CURRENT_USER}'."
echo
echo "[setup] To check the worker status:"
echo "  sudo systemctl status ${SERVICE_NAME}"
echo
echo "[setup] To see logs:"
echo "  journalctl -u ${SERVICE_NAME} -f"
echo
echo "[setup] From another machine, you can test:"
echo "  curl http://<THIS_MACHINE_IP>:${WORKER_PORT}/info"
echo "  curl http://<THIS_MACHINE_IP>:${WORKER_PORT}/health"
