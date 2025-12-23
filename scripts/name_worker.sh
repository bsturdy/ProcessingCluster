#!/usr/bin/env bash
set -euo pipefail

# Worker Name Convention Bootstrapper
# - Sets OS hostname to macworkerXXX
# - Ensures /etc/hostname and /etc/hosts consistent
# - Ensures operational user is worker001
# - Optionally migrates data from an existing per-worker user (e.g. worker002 -> worker001)
# - Optionally installs Docker and adds worker001 to docker group
#
# Usage:
#   sudo ./configure_worker_identity.sh --worker 2
#   sudo ./configure_worker_identity.sh --worker 2 --migrate-from worker002
#   sudo ./configure_worker_identity.sh --worker 2 --install-docker
#
# Inputs:
#   --worker N              Worker number (e.g. 1, 2, 12) -> zero-padded to 3 digits
#   --migrate-from USER     Rsync /home/USER -> /home/worker001 (does not delete source)
#   --install-docker        Install docker.io + enable service + add worker001 to docker group
#   --no-reboot             Do not reboot at the end
#
# Notes:
#   - This script does NOT set application-level worker_id in your repo (that’s separate).
#   - This script does NOT set a static IP. Use router DHCP reservation.

WORKER_NUM=""
MIGRATE_FROM=""
INSTALL_DOCKER="false"
DO_REBOOT="true"

die() { echo "ERROR: $*" >&2; exit 1; }

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "Run as root: sudo $0 ..."
  fi
}

usage() {
  cat <<'EOF'
Worker identity configurator

Required:
  --worker N              Worker number (e.g. 1, 2, 12) -> macworkerXXX

Optional:
  --migrate-from USER     Migrate /home/USER -> /home/worker001 via rsync
  --install-docker        Install docker.io and add worker001 to docker group
  --no-reboot             Do not reboot at the end

Examples:
  sudo ./configure_worker_identity.sh --worker 2
  sudo ./configure_worker_identity.sh --worker 2 --migrate-from worker002
  sudo ./configure_worker_identity.sh --worker 2 --install-docker
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --worker)
        WORKER_NUM="${2:-}"; shift 2;;
      --migrate-from)
        MIGRATE_FROM="${2:-}"; shift 2;;
      --install-docker)
        INSTALL_DOCKER="true"; shift;;
      --no-reboot)
        DO_REBOOT="false"; shift;;
      -h|--help)
        usage; exit 0;;
      *)
        die "Unknown arg: $1";;
    esac
  done

  [[ -n "$WORKER_NUM" ]] || die "--worker is required"
  [[ "$WORKER_NUM" =~ ^[0-9]+$ ]] || die "--worker must be an integer"

  if [[ -n "$MIGRATE_FROM" ]]; then
    [[ "$MIGRATE_FROM" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "--migrate-from invalid username"
  fi
}

pad3() {
  printf "%03d" "$1"
}

set_hostname_and_hosts() {
  local idx padded host
  idx="$1"
  padded="$(pad3 "$idx")"
  host="macworker${padded}"

  echo "==> Setting hostname to: ${host}"
  hostnamectl set-hostname "$host"

  echo "==> Writing /etc/hostname"
  echo "$host" > /etc/hostname

  echo "==> Ensuring /etc/hosts has 127.0.1.1 -> ${host}"
  # Remove existing 127.0.1.1 line(s), then add the correct one.
  # Keep localhost and IPv6 defaults.
  if grep -qE '^\s*127\.0\.1\.1\s+' /etc/hosts; then
    sed -i -E '/^\s*127\.0\.1\.1\s+/d' /etc/hosts
  fi

  # Ensure localhost line exists
  if ! grep -qE '^\s*127\.0\.0\.1\s+localhost(\s|$)' /etc/hosts; then
    echo "127.0.0.1 localhost" >> /etc/hosts
  fi

  echo "127.0.1.1 ${host}" >> /etc/hosts

  echo "==> Hostname set. Current:"
  hostnamectl --static
}

ensure_worker_user() {
  local user="worker001"

  echo "==> Ensuring user exists: ${user}"
  if id "$user" >/dev/null 2>&1; then
    echo "    User ${user} already exists."
  else
    adduser --disabled-password --gecos "" "$user"
    echo "    Created user ${user}."
  fi

  echo "==> Ensuring ${user} is in sudo group"
  usermod -aG sudo "$user" || true
}

install_docker_if_requested() {
  local user="worker001"

  if [[ "$INSTALL_DOCKER" != "true" ]]; then
    echo "==> Docker install skipped (not requested)."
    return
  fi

  echo "==> Installing Docker (docker.io)"
  apt-get update -y
  apt-get install -y docker.io

  echo "==> Enabling Docker service"
  systemctl enable --now docker

  echo "==> Adding ${user} to docker group"
  usermod -aG docker "$user" || true
}

migrate_home_if_requested() {
  local from="$1"
  local to_user="worker001"
  local to_dir="/home/${to_user}"

  [[ -n "$from" ]] || return

  echo "==> Migration requested: /home/${from} -> ${to_dir}"

  if ! id "$from" >/dev/null 2>&1; then
    die "migrate-from user does not exist: ${from}"
  fi
  if [[ ! -d "/home/${from}" ]]; then
    die "migrate-from home directory missing: /home/${from}"
  fi

  mkdir -p "$to_dir"

  echo "==> Rsyncing data (no deletion of source)"
  rsync -a "/home/${from}/" "${to_dir}/"

  echo "==> Fixing ownership"
  chown -R "${to_user}:${to_user}" "$to_dir"

  echo "==> Migration complete."
  echo "    NOTE: Source user/home not removed. If you want to remove later:"
  echo "      sudo deluser --remove-home ${from}"
}

print_summary() {
  local idx padded host
  idx="$1"
  padded="$(pad3 "$idx")"
  host="macworker${padded}"

  echo
  echo "=== SUMMARY ==="
  echo "Hostname (static): $(hostnamectl --static)"
  echo "Expected hostname : ${host}"
  echo "Current user      : $(logname 2>/dev/null || echo "(unknown)")"
  echo "worker001 exists  : $(id worker001 >/dev/null 2>&1 && echo yes || echo no)"
  echo "Home dirs         : $(ls -1 /home 2>/dev/null | tr '\n' ' ')"
  echo "IP addresses      :"
  ip -br a || true
  echo
  echo "Next steps (typical):"
  echo "  - Configure router DHCP reservation for this MAC/IP"
  echo "  - Deploy your worker repo and set worker_id=worker-${host} at the app layer"
  echo "  - Create/enable systemd service: processor-worker-${host}.service"
}

main() {
  require_root
  parse_args "$@"

  set_hostname_and_hosts "$WORKER_NUM"
  ensure_worker_user
  install_docker_if_requested
  migrate_home_if_requested "$MIGRATE_FROM"
  print_summary "$WORKER_NUM"

  if [[ "$DO_REBOOT" == "true" ]]; then
    echo "==> Rebooting to fully apply hostname/user session changes..."
    reboot
  else
    echo "==> Reboot skipped (--no-reboot)."
  fi
}

main "$@"
