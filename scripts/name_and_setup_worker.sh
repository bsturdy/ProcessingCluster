#!/usr/bin/env bash
set -euo pipefail

# ProcessorCluster Worker Bootstrap (NEW NAMING MODEL)
#
# Naming model enforced:
#   index N -> padded NNN
#   Hostname (OS)  = workerNNN
#   Username       = <os>workerNNN     (e.g. macworker004, winworker035)
#   Worker ID (app)= workerNNN         (same as hostname)
#   Service name   = processor-worker-workerNNN.service
#
# Usage:
#   sudo ./bootstrap_worker.sh --os mac --worker 2
#   sudo ./bootstrap_worker.sh --os linux --worker 12
#   sudo ./bootstrap_worker.sh --user-prefix nuc --worker 5
#
# Optional:
#   --repo URL
#   --port 9000
#   --max-jobs 8
#   --no-destructive
#   --no-reboot
#
# Notes:
# - Destructive by default: removes /home/<os>workerNNN/ProcessingCluster
# - Does not configure static IP; use router DHCP reservation.

GIT_REPO_URL="https://github.com/bsturdy/ProcessingCluster.git"
WORKER_PORT=9000
MAX_CONCURRENT_JOBS=8
DO_REBOOT="true"
DESTRUCTIVE_RESET="true"

WORKER_NUM=""
OS_CHOICE=""
USER_PREFIX=""

die() { echo "ERROR: $*" >&2; exit 1; }

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "Run as root: sudo $0 ..."
  fi
}

usage() {
  cat <<'EOF'
bootstrap_worker.sh (NEW NAMING MODEL)

Required:
  --worker N              Worker number (e.g. 1,2,12,34)
  One of:
    --os mac|linux|windows|pi|other
    --user-prefix PREFIX  Explicit username prefix (e.g. mac, win, linux, nuc)

Optional:
  --repo URL              Git repo URL
  --port N                Worker HTTP port (default: 9000)
  --max-jobs N            Max concurrent jobs (default: 8)
  --no-destructive        Do NOT delete existing repo directory
  --no-reboot             Do NOT reboot at end

Examples:
  sudo ./bootstrap_worker.sh --os mac --worker 2
  sudo ./bootstrap_worker.sh --os windows --worker 35
  sudo ./bootstrap_worker.sh --user-prefix nuc --worker 5
EOF
}

pad3() { printf "%03d" "$1"; }

os_to_userprefix() {
  case "$1" in
    mac) echo "mac" ;;
    linux) echo "linux" ;;
    windows|win) echo "win" ;;
    pi|raspberrypi) echo "pi" ;;
    other) echo "worker" ;;  # results in workerworkerNNN; prefer --user-prefix for other
    *) die "--os must be one of: mac|linux|windows|pi|other (or use --user-prefix)" ;;
  esac
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --worker) WORKER_NUM="${2:-}"; shift 2;;
      --os) OS_CHOICE="${2:-}"; shift 2;;
      --user-prefix) USER_PREFIX="${2:-}"; shift 2;;
      --repo) GIT_REPO_URL="${2:-}"; shift 2;;
      --port) WORKER_PORT="${2:-}"; shift 2;;
      --max-jobs) MAX_CONCURRENT_JOBS="${2:-}"; shift 2;;
      --no-destructive) DESTRUCTIVE_RESET="false"; shift;;
      --no-reboot) DO_REBOOT="false"; shift;;
      -h|--help) usage; exit 0;;
      *) die "Unknown arg: $1";;
    esac
  done

  [[ -n "$WORKER_NUM" ]] || die "--worker is required"
  [[ "$WORKER_NUM" =~ ^[0-9]+$ ]] || die "--worker must be an integer"
  [[ "$WORKER_PORT" =~ ^[0-9]+$ ]] || die "--port must be an integer"
  [[ "$MAX_CONCURRENT_JOBS" =~ ^[0-9]+$ ]] || die "--max-jobs must be an integer"

  if [[ -z "$USER_PREFIX" ]]; then
    [[ -n "$OS_CHOICE" ]] || die "Provide --os or --user-prefix"
    USER_PREFIX="$(os_to_userprefix "$OS_CHOICE")"
  fi

  [[ "$USER_PREFIX" =~ ^[a-z0-9_-]+$ ]] || die "--user-prefix must be simple (letters/numbers/_/-), no dots/spaces"
}

calc_identities() {
  local padded
  padded="$(pad3 "$WORKER_NUM")"

  HOSTNAME="worker${padded}"                 # OS hostname
  USERNAME="${USER_PREFIX}worker${padded}"   # login/service user
  HOME_DIR="/home/${USERNAME}"

  WORKER_ID="${HOSTNAME}"                    # app worker_id
  SERVICE_NAME="processor-worker-${HOSTNAME}.service"

  REPO_BASE="${HOME_DIR}/ProcessingCluster"
  WORKER_NODE_DIR="${REPO_BASE}/worker-agent/node"
  CFG_FILE="${WORKER_NODE_DIR}/config/worker-default.yaml"
}

set_hostname_and_hosts() {
  echo "[naming] Setting hostname -> ${HOSTNAME}"
  hostnamectl set-hostname "$HOSTNAME"
  echo "$HOSTNAME" > /etc/hostname

  echo "[naming] Updating /etc/hosts 127.0.1.1 entry -> ${HOSTNAME}"
  if grep -qE '^\s*127\.0\.1\.1\s+' /etc/hosts; then
    sed -i -E '/^\s*127\.0\.1\.1\s+/d' /etc/hosts
  fi
  if ! grep -qE '^\s*127\.0\.0\.1\s+localhost(\s|$)' /etc/hosts; then
    echo "127.0.0.1 localhost" >> /etc/hosts
  fi
  echo "127.0.1.1 ${HOSTNAME}" >> /etc/hosts

  echo "[naming] Hostname now: $(hostnamectl --static)"
}

ensure_user() {
  echo "[user] Ensuring user exists -> ${USERNAME}"
  if id "$USERNAME" >/dev/null 2>&1; then
    echo "[user] ${USERNAME} already exists"
  else
    adduser --gecos "" "$USERNAME"
    echo "${USERNAME}:1" | chpasswd
    echo "[user] Created ${USERNAME}"
  fi

  echo "[user] Ensuring ${USERNAME} in sudo group"
  usermod -aG sudo "$USERNAME" || true
}

install_deps() {
  echo "[deps] Installing git curl nodejs npm docker.io"
  apt update -y
  apt install -y git curl nodejs npm docker.io

  echo "[deps] Enabling Docker"
  systemctl enable --now docker

  echo "[deps] Ensuring ${USERNAME} in docker group"
  getent group docker >/dev/null 2>&1 || groupadd docker || true
  usermod -aG docker "$USERNAME" || true
}

deploy_repo() {
  echo "[repo] Repo base: ${REPO_BASE}"
  mkdir -p "$HOME_DIR"
  chown -R "${USERNAME}:${USERNAME}" "$HOME_DIR"

  if [[ -d "$REPO_BASE" && "$DESTRUCTIVE_RESET" == "true" ]]; then
    echo "[repo] Removing existing ${REPO_BASE} (destructive reset)"
    rm -rf "$REPO_BASE"
  fi

  if [[ ! -d "$REPO_BASE" ]]; then
    echo "[repo] Cloning ${GIT_REPO_URL}"
    sudo -u "$USERNAME" git clone "$GIT_REPO_URL" "$REPO_BASE"
  else
    echo "[repo] Repo exists and destructive reset disabled; leaving as-is"
  fi

  mkdir -p "$WORKER_NODE_DIR"
  chown -R "${USERNAME}:${USERNAME}" "$REPO_BASE"

  echo "[node] npm install"
  sudo -u "$USERNAME" bash -lc "cd '${WORKER_NODE_DIR}' && npm install"
  sudo -u "$USERNAME" bash -lc "cd '${WORKER_NODE_DIR}' && npm install cors --save"

  echo "[config] Writing ${CFG_FILE} (overwrite)"
  mkdir -p "$(dirname "$CFG_FILE")"
  cat > "$CFG_FILE" <<EOF
worker_id: "${WORKER_ID}"
port: ${WORKER_PORT}
max_concurrent_jobs: ${MAX_CONCURRENT_JOBS}
labels:
  - "ubuntu"
  - "${HOSTNAME}"
  - "${USER_PREFIX}"
EOF
  chown -R "${USERNAME}:${USERNAME}" "$(dirname "$CFG_FILE")"
}

create_systemd_service() {
  local service_path="/etc/systemd/system/${SERVICE_NAME}"

  echo "[systemd] Creating ${SERVICE_NAME} (runs as ${USERNAME})"
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true

  cat > "${service_path}" <<EOF
[Unit]
Description=ProcessorCluster Worker (${HOSTNAME})
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=${USERNAME}
WorkingDirectory=${WORKER_NODE_DIR}
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}" || systemctl start "${SERVICE_NAME}"
}

print_summary() {
  echo
  echo "=== SUMMARY ==="
  echo "Hostname (OS) : ${HOSTNAME}"
  echo "Username      : ${USERNAME}"
  echo "Home          : ${HOME_DIR}"
  echo "Worker ID(app): ${WORKER_ID}"
  echo "Port          : ${WORKER_PORT}"
  echo "Max jobs      : ${MAX_CONCURRENT_JOBS}"
  echo "Repo          : ${REPO_BASE}"
  echo "Worker dir    : ${WORKER_NODE_DIR}"
  echo "Config        : ${CFG_FILE}"
  echo "Service       : ${SERVICE_NAME}"
  echo
  echo "Checks:"
  echo "  systemctl status ${SERVICE_NAME}"
  echo "  journalctl -u ${SERVICE_NAME} -f"
  echo "  curl http://localhost:${WORKER_PORT}/info"
  echo "  curl http://localhost:${WORKER_PORT}/health"
  echo
}

main() {
  require_root
  parse_args "$@"
  calc_identities

  set_hostname_and_hosts
  ensure_user
  install_deps
  deploy_repo
  create_systemd_service
  print_summary

  if [[ "$DO_REBOOT" == "true" ]]; then
    echo "[reboot] Rebooting now (recommended for docker group + hostname propagation)"
    reboot
  else
    echo "[reboot] Skipped (--no-reboot)"
  fi
}

main "$@"
