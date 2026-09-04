#!/bin/sh
set -eu
node metrolinx-proxy.mjs &
PROXY_PID=$!
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT INT TERM
exec node server.mjs
