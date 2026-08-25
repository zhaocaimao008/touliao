#!/usr/bin/env bash
# ===================================================================
# 投聊 新服务器一键部署入口（bootstrap）
#
# 功能：
#   1) 环境预检（git/node/npm/pm2/磁盘）
#   2) 拉取代码 + 安装后端/前端依赖
#   3) 生成 .env（基于 backend-v2/.env.example，缺失变量自动补齐）
#   4) 启动后端（pm2: touliao-backend @ 3003）
#   5) 构建前端并部署到 /var/www/touliao
#   6) nginx 配置 + HTTPS 证书（certbot）
#   7) coturn（TURN 中继，修复对称 NAT 下语音通话连不上）
#   8) 健康检查（/health + 关键 API）+ 汇总报告
#
# 用法：
#   bash deploy/bootstrap-server.sh https://你的域名.com 你的邮箱 [PUBLIC_IP]
#   PUBLIC_IP 缺省时自动探测（用于 coturn external-ip）
#
# 可选环境变量：
#   ALERT_BOT_TOKEN=xxx ALERT_CHAT_ID=xxx SENTRY_DSN=xxx ADMIN_IP_WHITELIST=xxx
#   SKIP_COTURN=1        跳过 TURN 部署（已有 coturn 或不想装时）
# ===================================================================
set -euo pipefail
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${YEL}══ $* ══${NC}"; }

APP_URL="${1:-}"
EMAIL="${2:-}"
PUBLIC_IP="${3:-}"
[[ -n "$APP_URL" ]] || die "用法: bash deploy/bootstrap-server.sh https://你的域名.com 你的邮箱 [PUBLIC_IP]"
APP_URL="${APP_URL%/}"
HOST="${APP_URL#https://}"; HOST="${HOST#http://}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BE="$ROOT/backend-v2"
WEBROOT="/var/www/touliao"

# ── 0) 预检 ──────────────────────────────────────────────────────
step "0/8 环境预检"
command -v git >/dev/null || die "缺少 git"
command -v node >/dev/null || die "缺少 node"
command -v npm >/dev/null || die "缺少 npm"
command -v pm2 >/dev/null || die "缺少 pm2（npm i -g pm2）"
DISK_FREE=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
[[ "$DISK_FREE" -gt 5242880 ]] || warn "磁盘剩余 ${DISK_FREE}KB < 5GB，建议清理后继续"
ok "环境就绪（node $(node -v), pm2 已装, 磁盘 ${DISK_FREE}KB 可用）"

# ── 1) 后端 .env（缺失变量从 example 补齐，已有值保留）──────────
step "1/8 准备 .env"
ENV_FILE="$BE/.env"
if [[ -f "$ENV_FILE" ]]; then
  ok "检测到已有 .env（保留现有值，补齐缺失项）"
  cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
else
  cp "$BE/.env.example" "$ENV_FILE"
  ok "从 .env.example 生成 .env（请先人工填好 JWT_SECRET/ADMIN_PASSWORD 等必填项）"
fi
# 确保 APP_URL 存在（群邀请二维码等依赖）
if ! grep -qE "^APP_URL=" "$ENV_FILE"; then
  echo "APP_URL=$APP_URL" >> "$ENV_FILE"
  ok "已写入 APP_URL=$APP_URL"
fi
chmod 600 "$ENV_FILE"

# ── 2) 后端依赖 + 启动 ───────────────────────────────────────────
step "2/8 安装后端依赖"
cd "$BE"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

step "3/8 启动后端（pm2: touliao-backend）"
pm2 delete touliao-backend 2>/dev/null || true   # 清理可能残留的旧进程
PORT=3003 pm2 start src/server.js --name touliao-backend --update-env
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
sleep 3
curl -sf "http://127.0.0.1:3003/health" >/dev/null && ok "后端健康检查: 通过" \
  || warn "后端可能还在启动，稍候查看: pm2 logs touliao-backend --lines 50"

# ── 3) 前端构建 ──────────────────────────────────────────────────
step "4/8 构建前端"
cd "$ROOT/web"
npm ci && npm run build
mkdir -p "$WEBROOT"
rm -rf "$WEBROOT"/* 2>/dev/null || true
cp -r dist/* "$WEBROOT/" 2>/dev/null || cp -r build/* "$WEBROOT/" 2>/dev/null || warn "前端产物目录未知，请手动部署 dist/ 或 build/"
ok "前端已部署到 $WEBROOT"

# ── 4) nginx + HTTPS ─────────────────────────────────────────────
step "5/8 配置 nginx"
if [[ -f "$SCRIPT_DIR/nginx-touliao.conf.example" ]]; then
  if [[ -f /etc/nginx/sites-enabled/touliao.conf ]]; then
    ok "nginx 配置已存在，跳过（如需重写请手动操作）"
  else
    sed -e "s|server_name .*;|server_name $HOST www.$HOST;|" \
        -e "s|root .*;|root $WEBROOT;|" \
        "$SCRIPT_DIR/nginx-touliao.conf.example" > /etc/nginx/sites-available/touliao.conf
    ln -sf /etc/nginx/sites-available/touliao.conf /etc/nginx/sites-enabled/touliao.conf
    nginx -t && systemctl reload nginx && ok "nginx 已配置并 reload"
  fi
else
  warn "无 nginx 模板，请手动配置反代: 80→$WEBROOT, /api /uploads /health /download → 127.0.0.1:3003"
fi

step "6/8 HTTPS 证书（certbot）"
if command -v certbot >/dev/null 2>&1 && [[ -n "$EMAIL" ]]; then
  certbot --nginx -d "$HOST" -d "www.$HOST" --non-interactive --agree-tos -m "$EMAIL" --redirect 2>/dev/null \
    && ok "HTTPS 证书签发完成" || warn "certbot 签发失败（可稍后手动执行）"
else
  warn "未安装 certbot 或未提供邮箱，跳过 HTTPS（生产建议补装）"
fi

# ── 5) coturn（TURN 中继，语音通话必需）─────────────────────────
step "7/8 coturn（TURN 中继）"
if [[ "${SKIP_COTURN:-0}" == "1" ]]; then
  warn "SKIP_COTURN=1，跳过 TURN 部署（对称 NAT/4G 下语音可能连不上）"
else
  if [[ -z "$PUBLIC_IP" ]]; then
    PUBLIC_IP="$(curl -s4 --max-time 8 ifconfig.me 2>/dev/null || curl -s4 --max-time 8 ip.sb 2>/dev/null || true)"
    [[ -n "$PUBLIC_IP" ]] || warn "公网 IP 探测失败，请手动传入: bash $0 $APP_URL $EMAIL <PUBLIC_IP>"
  fi
  if [[ -n "$PUBLIC_IP" ]]; then
    if command -v turnserver >/dev/null 2>&1; then
      ok "coturn 已安装，校验配置"
      grep -qE '^static-auth-secret=' /etc/turnserver.conf && ok "TURN 已配置" \
        || bash "$SCRIPT_DIR/setup-coturn.sh" "$PUBLIC_IP" "$HOST" "$ENV_FILE"
    else
      bash "$SCRIPT_DIR/setup-coturn.sh" "$PUBLIC_IP" "$HOST" "$ENV_FILE"
    fi
    # 让后端读到 TURN 配置
    pm2 restart touliao-backend --update-env >/dev/null 2>&1 || true
    ok "TURN 配置已生效（TURN_SECRET/TURN_URLS 写入 .env）"
  fi
fi

# ── 6) 健康检查 ──────────────────────────────────────────────────
step "8/8 健康检查"
HEALTH_OK=0
for i in $(seq 1 10); do
  if curl -sf "http://127.0.0.1:3003/health" | grep -q '"ok":true'; then
    HEALTH_OK=1; break
  fi
  sleep 2
done
[[ "$HEALTH_OK" == "1" ]] && ok "后端 /health 正常" || die "后端 /health 异常"

echo
echo "============================================================"
echo "✅ 部署完成: $APP_URL"
echo "  后端     : pm2 touliao-backend @ 3003"
echo "  前端     : $WEBROOT"
echo "  nginx    : http(s)://$HOST"
echo "  TURN     : $(grep -E '^TURN_URLS=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo '未配置')"
echo "  健康检查 : curl http://127.0.0.1:3003/health"
echo "  日志     : pm2 logs touliao-backend --lines 50"
echo "  告警脚本 : $SCRIPT_DIR/touliao-alert.sh（cron 每 5 分钟）"
echo "============================================================"
