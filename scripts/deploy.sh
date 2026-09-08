#!/usr/bin/env bash
# Deploy the current commit to the frontend host.
#
# Every address here is a deployment variable, never a checked-in default: this
# repository is public, and a private host address in it is a private host
# address published. Set them in the shell that runs this, or it refuses.
#
#   DEPLOY_HOST      ssh target for the frontend host
#   DEPLOY_DIR       compose project directory on that host
#   ROUTING_ORIGIN   private routing origin the frontend calls
#   MAPS_ORIGIN      private map origin
#   TUNNEL_NETWORK   docker network shared with the tunnel connector
#   WEB_BIND_ADDRESS address the frontend binds on that host
#   WEB_PORT         port it binds
#   API_TAG          routing API image tag, left running as it is
#   OTP_URL          OpenTripPlanner origin the API uses
#   PUBLIC_URL       public origin to verify afterwards
#
# It rebuilds only the web service. The routing API keeps its image and its
# uptime, because recreating it reloads a multi-gigabyte graph and takes routing
# down for about a minute, which is not a thing to do by accident.
set -euo pipefail

for name in DEPLOY_HOST DEPLOY_DIR ROUTING_ORIGIN MAPS_ORIGIN TUNNEL_NETWORK \
            WEB_BIND_ADDRESS WEB_PORT API_TAG OTP_URL PUBLIC_URL; do
  if [ -z "${!name:-}" ]; then
    echo "deploy: $name is not set. Every address is a deployment variable." >&2
    exit 2
  fi
done

sha=$(git rev-parse HEAD)
case "$sha" in *[!0-9a-f]*|'') echo "deploy: bad commit" >&2; exit 2;; esac
[ "${#sha}" -eq 40 ] || { echo "deploy: expected a full sha" >&2; exit 2; }

# Refuse to ship a tree that does not match the commit being claimed. A deploy
# labelled with a commit it was not built from is worse than an unlabelled one.
if [ -n "$(git status --porcelain)" ]; then
  echo "deploy: the working tree is not clean, so the built artifact would not be $sha" >&2
  exit 2
fi

ssh_options=(-o StrictHostKeyChecking=accept-new -o UpdateHostKeys=no -o ConnectTimeout=20 -o BatchMode=yes)
archive="${TMPDIR:-/tmp}/gtha-$sha.tar.gz"

echo "deploy: $sha"
git archive --format=tar.gz -o "$archive" "$sha"
scp "${ssh_options[@]}" "$archive" "$DEPLOY_HOST:$DEPLOY_DIR/releases/"

ssh "${ssh_options[@]}" "$DEPLOY_HOST" "set -eu
  release=$DEPLOY_DIR/releases/$sha
  mkdir -p \"\$release\"
  tar -xzf $DEPLOY_DIR/releases/gtha-$sha.tar.gz -C \"\$release\"
  docker build --build-arg SOURCE_COMMIT=$sha -t gtha-transit-web:$sha \"\$release\" >/dev/null
  cd $DEPLOY_DIR
  SOURCE_COMMIT=$sha RELEASE_TAG=$sha \
    ROUTING_ORIGIN=$ROUTING_ORIGIN MAPS_ORIGIN=$MAPS_ORIGIN \
    TUNNEL_NETWORK=$TUNNEL_NETWORK \
    WEB_BIND_ADDRESS=$WEB_BIND_ADDRESS WEB_PORT=$WEB_PORT \
    API_TAG=$API_TAG OTP_URL=$OTP_URL \
    docker compose -p gtha-transit up -d --no-build web >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    state=\$(docker inspect -f '{{.State.Health.Status}}' gtha-transit-web)
    [ \"\$state\" = healthy ] && break
    sleep 4
  done
  echo \"container: \$state\"
"

# The container being healthy says the process started. Only the public origin
# says the deploy actually reached anyone.
served=$(curl -sS --max-time 20 "$PUBLIC_URL/version.json" | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).commit)}catch{console.log("unreadable")}})')
if [ "$served" != "$sha" ]; then
  echo "deploy: $PUBLIC_URL serves $served, expected $sha" >&2
  exit 1
fi
echo "deploy: $PUBLIC_URL serves $sha"
