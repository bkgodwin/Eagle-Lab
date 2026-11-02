#!/bin/sh
# Eagle-Lab: Ubuntu 22.04/24.04 LXC bootstrap. No Docker or nesting required.
set -eu
umask 077
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_DIR"
MODE=${1:-start}
case "$MODE" in start|--check|--install-service|--run) ;; *) echo 'Usage: ./start.sh [--check|--install-service]' >&2; exit 2 ;; esac

if [ "$(uname -s)" != Linux ]; then echo 'start.sh requires Linux. On Windows use node server.mjs.' >&2; exit 1; fi
if [ ! -f /etc/os-release ]; then echo 'An Ubuntu/Debian system is required.' >&2; exit 1; fi
. /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in ubuntu:*|debian:*|*:debian*) ;; *) echo 'This installer supports Ubuntu/Debian systems.' >&2; exit 1 ;; esac

as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@";
  elif command -v sudo >/dev/null 2>&1; then sudo "$@";
  else echo 'Installing system dependencies requires root or sudo.' >&2; exit 1; fi
}
missing=0
for tool in curl tar xz sha256sum; do command -v "$tool" >/dev/null 2>&1 || missing=1; done
if [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then missing=1; fi
if [ "$missing" -eq 1 ]; then
  if [ "$MODE" = --run ]; then echo 'Dependencies missing. Run ./start.sh manually to repair the installation.' >&2; exit 1; fi
  as_root apt-get update
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl xz-utils coreutils tar
fi

# Reuse a compatible Node runtime. Install locally rather than changing the host's Node.
NODE="$APP_DIR/.runtime/node/bin/node"
compatible() { "$1" -e "if (+process.versions.node.split('.')[0] < 24) process.exit(1); require('node:sqlite')" >/dev/null 2>&1; }
if [ ! -x "$NODE" ] || ! compatible "$NODE"; then
  if [ "$MODE" != --install-service ] && command -v node >/dev/null 2>&1 && compatible "$(command -v node)"; then NODE=$(command -v node);
  else
    if [ "$MODE" = --run ]; then echo 'Node runtime missing. Run ./start.sh manually to repair it.' >&2; exit 1; fi
    case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo 'Supported CPU architectures: x86_64 and ARM64.' >&2; exit 1 ;; esac
    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf -- "$TEMP_DIR"' EXIT HUP INT TERM
    RELEASE=https://nodejs.org/dist/latest-v24.x
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 "$RELEASE/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"
    ARCHIVE=$(awk -v arch="$ARCH" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") { print $2; exit }' "$TEMP_DIR/SHASUMS256.txt")
    [ -n "$ARCHIVE" ] || { echo 'Could not find the official Node.js 24 release.' >&2; exit 1; }
    echo "Installing $ARCHIVE from nodejs.org..."
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 "$RELEASE/$ARCHIVE" -o "$TEMP_DIR/$ARCHIVE"
    (cd "$TEMP_DIR" && awk -v file="$ARCHIVE" '$2 == file' SHASUMS256.txt | sha256sum --check --status)
    mkdir -p "$APP_DIR/.runtime/node"
    tar -xJf "$TEMP_DIR/$ARCHIVE" -C "$APP_DIR/.runtime/node" --strip-components=1 --no-same-owner
    # umask protects data, while the downloaded runtime must be runnable by the service user.
    chmod -R a+rX "$APP_DIR/.runtime"
    rm -rf -- "$TEMP_DIR"
    trap - EXIT HUP INT TERM
  fi
fi
compatible "$NODE" || { echo 'A working Node.js 24+ runtime with SQLite is required.' >&2; exit 1; }
export PATH="$(dirname "$NODE"):$PATH"
# Built-in Node APIs supply all application dependencies; no npm install is necessary.
"$NODE" --check server.mjs
if [ "$MODE" = --check ]; then "$NODE" --version; echo 'Eagle-Lab dependencies and syntax are ready.'; exit 0; fi

if [ "$MODE" = --install-service ]; then
  [ "$(id -u)" -eq 0 ] || { echo 'Run sudo ./start.sh --install-service from /opt/eagle-lab.' >&2; exit 1; }
  case "$APP_DIR" in /root|/root/*|/home|/home/*) echo 'Place the project in /opt/eagle-lab before installing the service (home directories are protected).' >&2; exit 1 ;; esac
  command -v systemctl >/dev/null 2>&1 || { echo 'The container must boot with systemd to install a service.' >&2; exit 1; }
  [ -d /run/systemd/system ] || { echo 'systemd is not running. Use ./start.sh in the foreground.' >&2; exit 1; }
  # Paths are interpolated into a unit file; reject systemd expansion/quoting characters.
  case "$APP_DIR" in *[!a-zA-Z0-9_./-]*) echo 'Use an installation path with letters, digits, dots, underscores, slashes, and hyphens.' >&2; exit 1 ;; esac
  getent passwd eagle-lab >/dev/null || useradd --system --user-group --home-dir "$APP_DIR/data" --no-create-home --shell /usr/sbin/nologin eagle-lab
  install -d -m 700 -o eagle-lab -g eagle-lab "$APP_DIR/data"
  chown -R eagle-lab:eagle-lab "$APP_DIR/data"
  chmod a+rx "$APP_DIR" "$APP_DIR/start.sh"
  if [ -f "$APP_DIR/.env" ]; then chown root:eagle-lab "$APP_DIR/.env"; chmod 640 "$APP_DIR/.env"; fi
  cat > /etc/systemd/system/eagle-lab.service <<EOF
[Unit]
Description=Eagle-Lab Proxmox classroom portal
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=eagle-lab
Group=eagle-lab
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/start.sh --run
Environment=NODE_ENV=production
Environment=AUTO_SETUP=1
Environment=PATH=$(dirname "$NODE"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable eagle-lab.service
  systemctl restart eagle-lab.service
  echo 'Eagle-Lab service started. View the first-run setup token: sudo journalctl -u eagle-lab -n 30 --no-pager'
  exit 0
fi
export AUTO_SETUP=1
echo 'Starting Eagle-Lab. Open the container IP on port 3000 (or the PORT in .env).'
exec "$NODE" --env-file-if-exists="$APP_DIR/.env" "$APP_DIR/server.mjs"
