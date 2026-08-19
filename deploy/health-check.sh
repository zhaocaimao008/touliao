#!/usr/bin/env bash
# ===================================================================
# 投聊 生产健康检查（独立脚本，可 cron 或人工执行）
#
# 用法:
#   bash deploy/health-check.sh              # 检查本机 touliao-backend@3002
#   PORT=3003 bash deploy/health-check.sh    # 检查其他端口（如投聊）
#   PM2_NAME=touliao-backend bash deploy/health-check.sh
#
# 退出码: 0=全部健康, 1=任一检查失败（cron 告警可据此触发）
# ===================================================================
set -uo pipefail
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; }
bad()  { echo -e "${RED}[✗]${NC} $*"; }

PORT="${PORT:-3002}"
PM2_NAME="${PM2_NAME:-touliao-backend}"
BASE="http://127.0.0.1:${PORT}"
FAIL=0

echo "══ v信 健康检查 (port=$PORT pm2=$PM2_NAME) $(date '+%F %T') ══"

# ── 1) 进程存活 ────────────────────────────────────────────────
if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_NAME\"" ; then
  STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    if p.get('name')=='$PM2_NAME':
        print(p.get('pm2_env',{}).get('status','?'), p.get('pm2_env',{}).get('restart_time',0))
        break
" 2>/dev/null)
  ST="${STATUS%% *}"
  if [[ "$ST" == "online" ]]; then
    ok "pm2 $PM2_NAME online（重启 ${STATUS##* } 次）"
  else
    bad "pm2 $PM2_NAME 状态异常: $STATUS"; FAIL=1
  fi
else
  bad "pm2 无进程 $PM2_NAME"; FAIL=1
fi

# ── 2) 端口监听 ─────────────────────────────────────────────────
if ss -tln 2>/dev/null | grep -q ":$PORT "; then
  ok "端口 $PORT 监听正常"
else
  bad "端口 $PORT 未监听"; FAIL=1
fi

# ── 3) /health 端点 ─────────────────────────────────────────────
H=$(curl -s --max-time 5 "$BASE/health" 2>/dev/null)
if echo "$H" | grep -q '"ok":true'; then
  ok "/health 正常: $H"
else
  bad "/health 异常: ${H:-无响应}"; FAIL=1
fi

# ── 4) 关键 API 冒烟（需 token；失败仅警告，不阻断）─────────────
AUTH=$(curl -s --max-time 5 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"phone":"","password":""}' 2>/dev/null | head -c 80)
if [[ -n "$AUTH" ]]; then
  ok "API 层响应正常（auth 端点可达）"
else
  warn "API 层无响应（auth 端点）"
fi

# ── 5) 系统资源 ─────────────────────────────────────────────────
MEM=$(free -m | awk 'NR==2 {printf "%d/%dMB", $3, $2}')
DISK=$(df -Pk / | awk 'NR==2 {printf "%d%%", $5}')
ok "内存 $MEM | 根分区已用 $DISK"
LOAD=$(uptime | grep -oE "load average: .*" | sed 's/load average: //')
warn "负载: $LOAD"

echo
if [[ "$FAIL" == "0" ]]; then
  echo -e "${GRN}✅ 全部检查通过${NC}"
  exit 0
else
  echo -e "${RED}❌ 存在 ${FAIL} 项异常，请查看: pm2 logs $PM2_NAME --lines 80${NC}"
  exit 1
fi
