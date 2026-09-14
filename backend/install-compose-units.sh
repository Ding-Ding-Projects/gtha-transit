#!/bin/sh
# Installs the units that bring a Compose stack back after a reboot and keep it
# reachable afterwards. Run as root on the host that runs the stack.
#
#   sudo backend/install-compose-units.sh <unit-name> <project-dir> [probe-url]
#
#   routing host:  gtha-transit-backend-compose /home/docker/gtha-transit-backend/backend http://<lan-address>:8790/otp/gtfs/v1
#   web host:      gtha-transit-compose         /home/docker/gtha-transit
#
# It writes three units:
#   <unit-name>.service           at boot: start the stack, repair, and retry until
#                                 the stack is attached and answering
#   <unit-name>-reattach.service  one repair pass
#   <unit-name>-reattach.timer    that pass two minutes after boot and every two
#                                 minutes after, for a detachment that happens later
#
# Safe to run again; it replaces the units and the installed script.
set -eu
NAME=${1:?unit name required}
PROJECT=${2:?project directory required}
PROBE_URL=${3:-}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
LIB=/usr/local/lib/gtha-transit
UNIT_DIR=/etc/systemd/system

[ -d "$PROJECT" ] || { echo "no such project directory: $PROJECT" >&2; exit 1; }
install -d "$LIB"
install -m 0755 "$SCRIPT_DIR/reattach-detached.sh" "$LIB/reattach-detached.sh"

cat > "$UNIT_DIR/$NAME.service" <<EOF
[Unit]
Description=GTHA Transit Compose stack ($PROJECT), started and verified at boot
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PROJECT
Environment=REATTACH_PROBE_URL=$PROBE_URL
ExecStart=$LIB/reattach-detached.sh --wait $PROJECT
Restart=on-failure
RestartSec=30
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

cat > "$UNIT_DIR/$NAME-reattach.service" <<EOF
[Unit]
Description=Repair a detached or unreachable container in $PROJECT
Requires=docker.service
After=docker.service $NAME.service

[Service]
Type=oneshot
WorkingDirectory=$PROJECT
Environment=REATTACH_PROBE_URL=$PROBE_URL
ExecStart=$LIB/reattach-detached.sh $PROJECT
EOF

cat > "$UNIT_DIR/$NAME-reattach.timer" <<EOF
[Unit]
Description=Check $PROJECT for detached containers every two minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=15s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable "$NAME.service"
systemctl enable --now "$NAME-reattach.timer"
echo "installed $NAME.service and $NAME-reattach.timer for $PROJECT"
