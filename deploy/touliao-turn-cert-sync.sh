#!/usr/bin/env bash
set -euo pipefail
[[ "${RENEWED_LINEAGE:-}" == '/etc/letsencrypt/live/touliao.cc' ]] || exit 0
[[ -d /etc/touliao-turn ]] || exit 0
install -o root -g nogroup -m 640 "$RENEWED_LINEAGE/fullchain.pem" /etc/touliao-turn/fullchain.pem
install -o root -g nogroup -m 640 "$RENEWED_LINEAGE/privkey.pem" /etc/touliao-turn/privkey.pem
docker restart touliao-coturn >/dev/null
