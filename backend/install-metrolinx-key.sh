#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TARGET=${METROLINX_KEY_FILE:-$SCRIPT_DIR/runtime/secrets/metrolinx-api-key}
mkdir -p "$(dirname "$TARGET")"
umask 077
IFS= read -r KEY
[ -n "$KEY" ] || { echo "credential input was empty" >&2; exit 1; }
TEMP="$TARGET.tmp.$$"
trap 'rm -f -- "$TEMP"' EXIT INT TERM
printf '%s\n' "$KEY" > "$TEMP"
chmod 600 "$TEMP"
mv -f "$TEMP" "$TARGET"
trap - EXIT INT TERM
echo "Metrolinx credential installed in protected host storage"
