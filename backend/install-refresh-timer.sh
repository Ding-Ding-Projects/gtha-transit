#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(dirname "$SCRIPT_DIR")
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/gtha-transit-refresh.service" <<EOF
[Unit]
Description=Refresh validated GTHA transit routing data
[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=$ROOT/backend/refresh.sh
EOF
cat > "$UNIT_DIR/gtha-transit-refresh.timer" <<EOF
[Unit]
Description=Daily GTHA transit routing refresh
[Timer]
OnCalendar=*-*-* 03:25:00 America/Toronto
Persistent=true
RandomizedDelaySec=20m
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now gtha-transit-refresh.timer
