#!/usr/bin/env bash
# 投聊 监控告警脚本
# 由 setup-new-server.sh 安装到 /usr/local/bin/touliao-alert，cron 每 5 分钟执行一次
# 不要手动编辑此文件路径/变量——由安装脚本注入 TOULIAO_ROOT
set -euo pipefail

: "${TOULIAO_ROOT:?需要 TOULIAO_ROOT 环境变量（由安装脚本设定）}"
ENV_FILE="$TOULIAO_ROOT/backend-v2/.env"
BE_PORT="${BE_PORT:-3003}"
PM2_APP="${PM2_APP:-touliao-backend}"
MEM_THRESHOLD="${ALERT_MEM_THRESHOLD:-85}"
DISK_THRESHOLD="${ALERT_DISK_THRESHOLD:-85}"

# 从 .env 读取 Telegram 配置
[[ -f "$ENV_FILE" ]] && source <(grep -E "^(ALERT_BOT_TOKEN|ALERT_CHAT_ID)=" "$ENV_FILE") 2>/dev/null || true
BOT_TOKEN="${ALERT_BOT_TOKEN:-}"
CHAT_ID="${ALERT_CHAT_ID:-}"

tg() {
  [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]] && return 0
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" -d "text=$1" -d "parse_mode=HTML" -o /dev/null
}

# 1. pm2 进程存活
if ! pm2 info "$PM2_APP" 2>/dev/null | grep -q "online"; then
  tg "🔴 <b>投聊后端宕机</b>: $PM2_APP 不在线"
fi

# 2. /health 端点
HEALTH=$(curl -sf "http://127.0.0.1:${BE_PORT}/health" --max-time 5 \
  -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
if [[ "$HEALTH" != "200" ]]; then
  tg "🔴 <b>投聊 /health 异常</b>: HTTP $HEALTH"
fi

# 3. 内存
MEM=$(free | awk '/Mem/ {printf "%.0f", $3/$2*100}')
if [[ "${MEM:-0}" -gt "$MEM_THRESHOLD" ]]; then
  tg "🟡 <b>投聊内存告警</b>: ${MEM}% (>$MEM_THRESHOLD%)"
fi

# 4. 磁盘
DISK=$(df "$TOULIAO_ROOT" | awk 'NR==2{print $5}' | tr -d '%')
if [[ "${DISK:-0}" -gt "$DISK_THRESHOLD" ]]; then
  tg "🟡 <b>投聊磁盘告警</b>: ${DISK}% (>$DISK_THRESHOLD%)"
fi

# 5. pm2 重启次数
RESTARTS=$(pm2 info "$PM2_APP" 2>/dev/null | awk '/restart time/{print $NF}' || echo 0)
if [[ "${RESTARTS:-0}" -gt 5 ]]; then
  tg "🟡 <b>投聊频繁重启</b>: 已重启 ${RESTARTS} 次"
fi
