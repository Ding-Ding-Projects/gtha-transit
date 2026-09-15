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

# A container started by hand onto the project's network (not a Compose
# service) cannot be recreated from the compose file. With no published ports,
# connecting it back to the network it asked for is enough; with ports it needs
# a person, and that must not stall the boot unit forever.
classify_manual() {
  running=$1 networks=$2 bindings=$3
  if [ "$running" != true ] || [ "$networks" -gt 0 ]; then echo ok; return; fi
  if [ "$bindings" -gt 0 ]; then echo manual; return; fi
  echo connect
}

# Docker writes a container's resolver configuration when it starts. A container
# its restart policy started at boot, before the host had a nameserver from DHCP,
# keeps "NO EXTERNAL NAMESERVERS DEFINED" for life: it has a network, answers on
# its ports, and cannot resolve a single outside name. That silently stopped the
# GO and UP updates after the 14 September reboot. Recreating it once the host
# has a nameserver fixes it; recreating before then would only repeat the fault.
classify_dns() {
  container_has_upstream=$1 host_has_nameserver=$2
  if [ "$container_has_upstream" = yes ]; then echo ok; return; fi
  if [ "$host_has_nameserver" = yes ]; then echo recreate; return; fi
  echo wait
}

if [ "${1:-}" = --classify-dns ]; then
  shift
  classify_dns "$1" "$2"
  exit 0
fi
if [ "${1:-}" = --classify ]; then
  shift
  classify "$1" "$2" "$3" "$4"
  exit 0
fi
if [ "${1:-}" = --classify-manual ]; then
  shift
  classify_manual "$1" "$2" "$3"
  exit 0
fi

WAIT=0
if [ "${1:-}" = --wait ]; then WAIT=1; shift; fi
DIR=${1:?project directory required}
cd "$DIR"
PROJECT=${COMPOSE_PROJECT_NAME:-$(basename "$(pwd -P)")}

PROBE_URL=${REATTACH_PROBE_URL:-}
PROBE_SERVICE=${REATTACH_PROBE_SERVICE:-otp}
GRACE=${REATTACH_GRACE_SECONDS:-300}
DEADLINE=$(( $(date +%s) + ${REATTACH_WAIT_SECONDS:-600} ))

log() { echo "reattach: $*"; }

recreate() {
  log "recreating $1 ($2)"
  docker compose up -d --force-recreate --no-deps "$1"
}

host_nameserver() {
  for file in /etc/resolv.conf /run/systemd/resolve/resolv.conf; do
    if [ -r "$file" ] && grep -Eq '^nameserver[[:space:]]+[^[:space:]]' "$file" \
      && ! grep -Eq '^nameserver[[:space:]]+127\.0\.0\.53' "$file"; then
      echo yes; return
    fi
  done
  echo no
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
      continue
    fi
    [ "$1" = true ] || continue
    upstream=yes
    if docker exec "$id" cat /etc/resolv.conf 2>/dev/null | grep -q 'NO EXTERNAL NAMESERVERS DEFINED'; then upstream=no; fi
    case $(classify_dns "$upstream" "$(host_nameserver)") in
      recreate) recreate "$service" "started without an upstream DNS server"; clean=1 ;;
      wait) log "$service has no upstream DNS and neither does the host yet"; clean=1 ;;
    esac
  done
  project_networks=$(docker network ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}')
  for id in $(docker ps -q --filter "status=running"); do
    set -- $(docker inspect -f '{{.State.Running}} {{len .NetworkSettings.Networks}} {{len .HostConfig.PortBindings}} {{.HostConfig.NetworkMode}} {{.Name}} x{{index .Config.Labels "com.docker.compose.project"}}' "$id")
    [ "$6" = x ] || continue
    echo "$project_networks" | grep -qx "$4" || continue
    case $(classify_manual "$1" "$2" "$3") in
      connect)
        log "reconnecting hand-started ${5#/} to $4"
        docker network connect "$4" "$id" || log "could not reconnect ${5#/}"
        ;;
      manual)
        log "hand-started ${5#/} is detached and publishes ports; recreate it by hand"
        ;;
    esac
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
