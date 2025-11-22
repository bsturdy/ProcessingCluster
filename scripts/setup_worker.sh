#!/usr/bin/env bash
set -euo pipefail

# Git repo URL for your ProcessorCluster project
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

### 1. Update apt and install dependencies #####################################

echo "[setup] Updating apt and installing dependencies (git, curl, nodejs, npm, docker.io)..."

sudo apt update -y
sudo apt install -y git curl nodejs npm docker.io

### 2. Ensure current user is in docker group ##################################

CURRENT_USER="$(whoami)"
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
    "js-yaml": "^4.1.0"
  }
}
EOF
else
  echo "[setup] package.json already exists; ensuring type=module and dependencies..."

  # Add "type": "module" if missing
  if ! grep -q '"type"' package.json; then
    tmpfile="$(mktemp)"
    jq '. + { "type": "module" }' package.json > "$tmpfile" && mv "$tmpfile" package.json || echo "[setup] Warning: could not add type=module automatically (jq missing?)"
  else
    echo "[setup] 'type' already defined in package.json (check it is \"module\")."
  fi

  # We still run npm install below which will install missing deps.
fi

### 6. Install node dependencies ##############################################

echo "[setup] Running npm install..."
npm install

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

### 8. Summary #################################################################

echo
echo "[setup] Worker setup complete."
echo "[setup] Repo directory: ${BASE_DIR}"
echo "[setup] Worker node directory: ${WORKER_NODE_DIR}"
echo "[setup] Config file: ${CONFIG_FILE}"
echo
echo "[setup] IMPORTANT:"
echo "  - If this is the first time you were added to the 'docker' group,"
echo "    you must log out and log back in (or reboot) before Docker commands work without sudo."
echo
echo "[setup] To start the worker manually, run:"
echo "  cd \"${WORKER_NODE_DIR}\""
echo "  node src/index.js"
echo
echo "[setup] You can test it from another machine with:"
echo "  curl http://<THIS_MACHINE_IP>:${WORKER_PORT}/info"
echo "  curl http://<THIS_MACHINE_IP>:${WORKER_PORT}/health"
echo
