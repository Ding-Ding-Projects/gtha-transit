#!/bin/sh
# Brings a Compose stack back after a reboot and repairs a container that is
# running but unreachable.
#
# After a host reboot Docker's restart policy can start a container before its
# network is ready. The container then reports "Up", has no network and no
# published port, and `docker compose up -d` leaves it alone because it is
# running. `docker restart` does not reattach it either. Only a recreate does.
# This happened to OpenTripPlanner on 9 and 14 September 2026, and every journey
# failed until somebody noticed. See docs/deployment/restarting.md.
#
# Usage:
#   reattach-detached.sh --wait <project-dir>   boot: start the stack, repair, and
#                                               keep going until healthy or the
#                                               deadline passes (exit 1)
#   reattach-detached.sh <project-dir>          watchdog: one repair pass, never
#                                               starts a service somebody stopped
#   reattach-detached.sh --classify RUNNING NETWORKS BINDINGS PORTS
#                                               prints "recreate" or "ok" (tests)
#
# Optional environment:
#   REATTACH_PROBE_URL      OTP GraphQL endpoint to probe, e.g. http://host:8790/otp/gtfs/v1
#   REATTACH_PROBE_SERVICE  Compose service recreated when the probe keeps failing (default otp)
#   REATTACH_GRACE_SECONDS  how long a container may be up before a failed probe
#                           counts against it; covers the graph load (default 300)
#   REATTACH_WAIT_SECONDS   deadline for --wait (default 600)
set -eu

# A running container with no network, or one that asks for published ports and
# has none, cannot be reached and has to be recreated.
classify() {
  running=$1 networks=$2 bindings=$3 ports=$4
  if [ "$running" != true ]; then echo ok; return; fi
  if [ "$networks" -eq 0 ]; then echo recreate; return; fi
  if [ "$bindings" -gt 0 ] && [ "$ports" -eq 0 ]; then echo recreate; return; fi
  echo ok
}

if [ "${1:-}" = --classify ]; then
  shift
  classify "$1" "$2" "$3" "$4"
  exit 0
fi

WAIT=0
if [ "${1:-}" = --wait ]; then WAIT=1; shift; fi
DIR=${1:?project directory required}
cd "$DIR"

PROBE_URL=${REATTACH_PROBE_URL:-}
PROBE_SERVICE=${REATTACH_PROBE_SERVICE:-otp}
GRACE=${REATTACH_GRACE_SECONDS:-300}
DEADLINE=$(( $(date +%s) + ${REATTACH_WAIT_SECONDS:-600} ))

log() { echo "reattach: $*"; }

recreate() {
  log "recreating $1 ($2)"
  docker compose up -d --force-recreate --no-deps "$1"
}

probe_ok() {
  [ -z "$PROBE_URL" ] && return 0
  curl -fsS -m 10 -X POST -H 'content-type: application/json' \
    --data '{"query":"{ stop(id:\"go:UN\") { name } }"}' "$PROBE_URL" 2>/dev/null \
    | grep -q 'Union Station GO'
}

# One pass. Returns 0 when nothing needed repair and the probe answered.
repair_pass() {
  clean=0
  for id in $(docker compose ps -q); do
    service=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")
    set -- $(docker inspect -f '{{.State.Running}} {{len .NetworkSettings.Networks}} {{len .HostConfig.PortBindings}} {{len .NetworkSettings.Ports}}' "$id")
    if [ "$(classify "$1" "$2" "$3" "$4")" = recreate ]; then
      recreate "$service" "running with $2 networks and $4 of $3 published ports"
      clean=1
    fi
  done
  if ! probe_ok; then
    id=$(docker compose ps -q "$PROBE_SERVICE" 2>/dev/null || true)
    if [ -n "$id" ]; then
      started=$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$id")" +%s 2>/dev/null || date +%s)
      if [ $(( $(date +%s) - started )) -ge "$GRACE" ]; then
        recreate "$PROBE_SERVICE" "probe failing after ${GRACE}s up"
      else
        log "$PROBE_SERVICE probe not answering yet (still inside its ${GRACE}s grace)"
      fi
    else
      log "$PROBE_SERVICE has no running container"
    fi
    clean=1
  fi
  return $clean
}

if [ "$WAIT" -eq 0 ]; then
  repair_pass
  exit $?
fi

docker compose up -d
while :; do
  if repair_pass; then
    log "stack attached and answering"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    log "still unhealthy at the deadline; systemd will retry"
    exit 1
  fi
  sleep 10
done
