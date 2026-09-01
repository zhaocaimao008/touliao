#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/deploy/check-turn-relay.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/node" <<'NODE'
#!/usr/bin/env bash
set -euo pipefail
printf 'fixture=%s\n' "${TURN_PROBE_FIXTURE:-missing-secret}"
case "${TURN_PROBE_FIXTURE:-missing-secret}" in
  relay-ok) echo "TURN relay allocation: PASS"; exit 0 ;;
  *) echo "TURN relay allocation: FAIL (fixture)"; exit 1 ;;
esac
NODE
chmod +x "$TMP/node"

run_case() {
  local fixture="$1" expected="$2" secret="fixture-secret-not-for-output"
  local env_file="$TMP/${fixture}.env" output status
  if [[ "$fixture" == "missing-secret" ]]; then
    printf 'TURN_URLS=turn:127.0.0.1:3478?transport=udp\n' > "$env_file"
  else
    printf 'TURN_SECRET=%s\nTURN_URLS=turn:127.0.0.1:3478?transport=udp\n' "$secret" > "$env_file"
  fi
  set +e
  output="$(PATH="$TMP:$PATH" TURN_PROBE_FIXTURE="$fixture" bash "$SCRIPT" --env-file "$env_file" 2>&1)"
  status=$?
  set -e
  [[ "$status" -eq "$expected" ]] || { printf '%s\n' "$output" >&2; return 1; }
  [[ "$output" != *"$secret"* ]] || { printf 'secret leaked\n%s\n' "$output" >&2; return 1; }
}

run_case missing-secret 1
run_case allocation-failed 1
run_case relay-ok 0
grep -q 'TURN relay allocation: PASS' <(PATH="$TMP:$PATH" TURN_PROBE_FIXTURE=relay-ok bash "$SCRIPT" --env-file "$TMP/relay-ok.env")

echo "check-turn-relay shell contract: PASS"
