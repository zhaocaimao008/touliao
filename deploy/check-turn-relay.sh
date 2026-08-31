#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    *) echo "用法: bash $0 --env-file /absolute/path" >&2; exit 2 ;;
  esac
done
[[ -n "$ENV_FILE" && "$ENV_FILE" = /* && -f "$ENV_FILE" ]] || { echo "TURN relay allocation: FAIL (env file)" >&2; exit 1; }

# Read only the required keys; never echo the sourced environment.
TURN_SECRET=""; TURN_URLS=""
while IFS='=' read -r key value; do
  case "$key" in
    TURN_SECRET) TURN_SECRET="$value" ;;
    TURN_URLS) TURN_URLS="$value" ;;
  esac
done < <(grep -E '^(TURN_SECRET|TURN_URLS)=' "$ENV_FILE" || true)
[[ -n "$TURN_SECRET" && -n "$TURN_URLS" ]] || { echo "TURN relay allocation: FAIL (missing configuration)" >&2; exit 1; }

TURN_PROBE_USERNAME="$(date +%s):turn-probe"
TURN_PROBE_CREDENTIAL="$(printf '%s' "$TURN_PROBE_USERNAME" | openssl dgst -sha1 -hmac "$TURN_SECRET" -binary | base64 -w0)"
export TURN_PROBE_URL="$TURN_URLS" TURN_PROBE_USERNAME TURN_PROBE_CREDENTIAL
exec node "$SCRIPT_DIR/lib/turn-allocation-probe.js"
