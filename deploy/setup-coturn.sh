#!/usr/bin/env bash
# ============================================================
# v信 一键部署 coturn（TURN 中继）—— 修复 4G/对称 NAT 下语音视频通话连不上
# ============================================================
# 用法：
#   sudo bash deploy/setup-coturn.sh <PUBLIC_IP> <REALM> [BACKEND_ENV_PATH]
# 例：
#   sudo bash deploy/setup-coturn.sh 93.179.127.50 dipsin.com /root/v信/backend-v2/.env
#
# 做的事：
#   1) 安装 coturn
#   2) 用 use-auth-secret(REST 时效凭证)模式配置 /etc/turnserver.conf
#      —— 与后端 buildIceServers() 的 HMAC-SHA1(secret) 凭证完全对应
#   3) 把 TURN_SECRET / TURN_URLS / TURN_TTL 幂等写入后端 .env
#   4) 放行防火墙端口(3478 udp/tcp + 中继 49152-65535/udp)
#   5) enable + restart coturn
# 之后需：pm2 restart vxin-server-v2 --update-env  让后端读到新 env。
# 幂等：重复执行复用已存在的 TURN_SECRET，不会改变客户端凭证算法。
set -euo pipefail

PUBLIC_IP="${1:-}"
REALM="${2:-}"
ENV_FILE="${3:-/root/v信/backend-v2/.env}"
TURN_CONF="/etc/turnserver.conf"
TTL="${TURN_TTL:-3600}"
MIN_PORT=49152
MAX_PORT=65535

if [[ -z "$PUBLIC_IP" || -z "$REALM" ]]; then
  echo "❌ 用法: sudo bash $0 <PUBLIC_IP> <REALM> [BACKEND_ENV_PATH]" >&2
  exit 2
fi
if [[ $EUID -ne 0 ]]; then echo "❌ 需 root 运行(加 sudo)" >&2; exit 2; fi

echo "▶ coturn 部署：IP=$PUBLIC_IP REALM=$REALM ENV=$ENV_FILE"

# ── 1) 复用/生成 TURN_SECRET（幂等）──
SECRET=""
if [[ -f "$ENV_FILE" ]]; then
  SECRET="$(grep -E '^TURN_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
fi
if [[ -z "$SECRET" ]] && [[ -f "$TURN_CONF" ]]; then
  SECRET="$(grep -E '^static-auth-secret=' "$TURN_CONF" | head -1 | cut -d= -f2- || true)"
fi
if [[ -z "$SECRET" ]]; then
  SECRET="$(openssl rand -hex 32)"
  echo "  · 生成新 TURN_SECRET"
else
  echo "  · 复用已有 TURN_SECRET"
fi

# ── 2) 安装 coturn ──
if ! command -v turnserver >/dev/null 2>&1; then
  echo "▶ 安装 coturn …"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y -q
  apt-get install -y -q coturn
else
  echo "  · coturn 已安装"
fi

# ── 3) 写 coturn 配置 ──
echo "▶ 写 $TURN_CONF"
cat > "$TURN_CONF" <<EOF
# v信 coturn —— use-auth-secret(REST)模式，由 deploy/setup-coturn.sh 生成
listening-port=3478
listening-ip=0.0.0.0
external-ip=$PUBLIC_IP
realm=$REALM
server-name=$REALM

# REST 时效凭证：与后端 config.turn.secret 一致
use-auth-secret
static-auth-secret=$SECRET

# 中继端口范围
min-port=$MIN_PORT
max-port=$MAX_PORT

fingerprint
no-cli
no-tlsv1
no-tlsv1_1
no-multicast-peers
stale-nonce=600

# 安全：禁止把流量中继进内网/回环(防 SSRF)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
EOF

# 可选 TLS(turns:5349)：若存在 letsencrypt 证书则启用
CERT_DIR="/etc/letsencrypt/live/$REALM"
TURNS_URL=""
if [[ -f "$CERT_DIR/fullchain.pem" && -f "$CERT_DIR/privkey.pem" ]]; then
  echo "  · 检测到 $REALM 证书，启用 turns:5349 (TLS)"
  cat >> "$TURN_CONF" <<EOF

tls-listening-port=5349
cert=$CERT_DIR/fullchain.pem
pkey=$CERT_DIR/privkey.pem
EOF
  # coturn 需能读证书
  usermod -aG ssl-cert turnserver 2>/dev/null || true
  TURNS_URL=",turns:$REALM:5349"
fi

# ── 4) 启用 coturn 守护 ──
if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
fi

# ── 5) 防火墙放行 ──
echo "▶ 放行端口 3478(udp/tcp) + $MIN_PORT-$MAX_PORT/udp"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 3478/udp  >/dev/null 2>&1 || true
  ufw allow 3478/tcp  >/dev/null 2>&1 || true
  ufw allow 5349/tcp  >/dev/null 2>&1 || true
  ufw allow ${MIN_PORT}:${MAX_PORT}/udp >/dev/null 2>&1 || true
  echo "  · ufw 已放行"
else
  echo "  ⚠ 未检测到活动 ufw。若云厂商有安全组，请手动放行："
  echo "     3478/udp, 3478/tcp, 5349/tcp, ${MIN_PORT}-${MAX_PORT}/udp"
fi

# ── 6) 启动 coturn ──
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 2
systemctl is-active --quiet coturn && echo "✅ coturn 运行中" || { echo "❌ coturn 未启动，查 journalctl -u coturn"; exit 1; }

# ── 7) 幂等写后端 .env ──
TURN_URLS="turn:${PUBLIC_IP}:3478?transport=udp,turn:${PUBLIC_IP}:3478?transport=tcp${TURNS_URL}"
echo "▶ 更新后端 env: $ENV_FILE"
touch "$ENV_FILE"
set_env() { # key value
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$ENV_FILE"; then
    # 用 | 作分隔避免 url 里的 / 干扰
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    echo "${k}=${v}" >> "$ENV_FILE"
  fi
}
set_env TURN_SECRET "$SECRET"
set_env TURN_URLS   "$TURN_URLS"
set_env TURN_TTL    "$TTL"

echo
echo "============================================================"
echo "✅ coturn 部署完成"
echo "  realm     : $REALM"
echo "  external  : $PUBLIC_IP"
echo "  TURN_URLS : $TURN_URLS"
echo "  TURN_TTL  : $TTL"
echo "  secret    : (已写入 coturn 与 .env，未回显)"
echo
echo "👉 下一步(让后端读到新 env)："
echo "   pm2 restart vxin-server-v2 --update-env && pm2 save"
echo "   然后 curl -s http://127.0.0.1:3002/api/turn/credentials -H 'Authorization: Bearer <token>'"
echo "   应能看到 iceServers 里出现 turn: 服务器。"
echo "============================================================"
