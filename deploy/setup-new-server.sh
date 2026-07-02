#!/usr/bin/env bash
# ===================================================================
# v信 一键部署脚本（新服务器）
#
# 最简用法:
#   git clone https://github.com/zhaocaimao008/vxin-1.0.git
#   cd vxin-1.0
#   bash deploy/setup-new-server.sh https://你的域名.com 你的邮箱
#
# 可选环境变量（在命令前加 KEY=val）:
#   ALERT_BOT_TOKEN=xxx   Telegram 告警 Bot Token
#   ALERT_CHAT_ID=xxx     Telegram 告警 Chat ID
#   SENTRY_DSN=https://…  Sentry 错误监控 DSN
#   ADMIN_IP_WHITELIST=   管理后台 IP 白名单（留空=自动检测当前 SSH IP）
#
# 示例:
#   ALERT_BOT_TOKEN=xxx ALERT_CHAT_ID=yyy \
#     bash deploy/setup-new-server.sh https://chat.example.com admin@example.com
# ===================================================================
set -euo pipefail
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${YEL}══ $* ══${NC}"; }

APP_URL="${1:-}"
EMAIL="${2:-}"
[[ -n "$APP_URL" ]] || die "用法: bash deploy/setup-new-server.sh https://你的域名.com [邮箱]"
APP_URL="${APP_URL%/}"
HOST="${APP_URL#https://}"; HOST="${HOST#http://}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BE="$ROOT/backend-v2"
WEBROOT="/var/www/vxin"

apt_pkg() { command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >/dev/null || true; }

# ── [1/8] 环境检查 ──────────────────────────────────────────────────
step "1/8 检查环境"
command -v node >/dev/null || die "未找到 Node.js，请先安装 Node 20+:\n  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
NODE_VER=$(node -p 'process.versions.node.split(".")[0]')
[[ "$NODE_VER" -ge 20 ]] || die "Node 需 ≥20，当前 $(node -v)"
ok "Node $(node -v)"
command -v npm >/dev/null || die "未找到 npm"
command -v pm2 >/dev/null || { warn "安装 pm2..."; npm i -g pm2; }
command -v make >/dev/null && command -v g++ >/dev/null || { warn "安装编译工具..."; apt_pkg build-essential python3; }
command -v sqlite3 >/dev/null || { warn "安装 sqlite3..."; apt_pkg sqlite3; }
ok "环境就绪"

# ── [2/8] 后端依赖 ──────────────────────────────────────────────────
step "2/8 安装后端依赖"
cd "$BE" && npm ci
ok "npm ci 完成"

# ── [3/8] 生成 .env ─────────────────────────────────────────────────
step "3/8 生成 .env"
if [[ -f "$BE/.env" ]]; then
  ok "已有 .env，跳过生成（如需重置请删除后重跑）"
else
  # 随机生成所有密钥
  JWT="$(openssl rand -hex 48)"
  AJWT="$(openssl rand -hex 48)"
  APW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  read -r VPUB VPRIV < <(node -e "
    const w=require('web-push');
    const k=w.generateVAPIDKeys();
    process.stdout.write(k.publicKey+' '+k.privateKey);
  ")

  # 自动检测当前 SSH 客户端 IP 作为 admin 白名单
  AUTO_IP=""
  if [[ -n "${SSH_CLIENT:-}" ]]; then
    AUTO_IP=$(echo "$SSH_CLIENT" | awk '{print $1}')
  elif [[ -n "${SSH_CONNECTION:-}" ]]; then
    AUTO_IP=$(echo "$SSH_CONNECTION" | awk '{print $1}')
  fi
  # 支持外部传入覆盖
  ADMIN_WL="${ADMIN_IP_WHITELIST:-${AUTO_IP:-}}"

  cat > "$BE/.env" <<ENV
PORT=3002
NODE_ENV=production
APP_URL=$APP_URL

JWT_SECRET=$JWT
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$APW
ADMIN_JWT_SECRET=$AJWT

VAPID_PUBLIC_KEY=$VPUB
VAPID_PRIVATE_KEY=$VPRIV
VAPID_EMAIL=mailto:admin@$HOST

# 单文件上传上限（字节）。安全兜底 1GB，防超大文件占爆磁盘。留空=不限制。
MAX_UPLOAD_BYTES=1073741824

# 管理后台 IP 白名单（逗号分隔，留空=不限制）
ADMIN_IP_WHITELIST=${ADMIN_WL}

# 错误监控 Sentry（填入后重启自动启用）
# 获取: https://sentry.io → 新建 Node.js 项目 → 复制 DSN
SENTRY_DSN=${SENTRY_DSN:-}

# Telegram 告警（告警脚本读取此处）
ALERT_BOT_TOKEN=${ALERT_BOT_TOKEN:-}
ALERT_CHAT_ID=${ALERT_CHAT_ID:-}
ENV

  echo "$APW" > "$BE/ADMIN_PASSWORD.txt"
  chmod 600 "$BE/.env" "$BE/ADMIN_PASSWORD.txt"
  ok ".env 已生成，admin 密码: $APW（已存 backend-v2/ADMIN_PASSWORD.txt）"
  [[ -n "$ADMIN_WL" ]] && ok "ADMIN_IP_WHITELIST=$ADMIN_WL" || warn "未检测到 SSH IP，管理后台暂不限制 IP（部署后可在 .env 设置）"
fi

# ── [4/8] 启动后端 ──────────────────────────────────────────────────
step "4/8 启动后端 (pm2)"
cd "$BE"
pm2 start ecosystem.config.js --update-env 2>/dev/null || \
  pm2 restart vxin-server-v2 --update-env 2>/dev/null || \
  pm2 start src/server.js --name vxin-server-v2
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
sleep 2
curl -sf "http://127.0.0.1:3002/health" >/dev/null && ok "后端健康检查: 通过" || warn "后端可能还在启动，稍候查看: pm2 logs vxin-server-v2"

# ── [5/8] 前端构建 ──────────────────────────────────────────────────
step "5/8 构建前端"
cd "$ROOT/web" && npm ci && npm run build
mkdir -p "$WEBROOT"
rm -rf "${WEBROOT:?}/"*
cp -r dist/* "$WEBROOT"/
ok "前端已部署到 $WEBROOT"

# ── [6/8] nginx ─────────────────────────────────────────────────────
step "6/8 配置 nginx"
command -v nginx >/dev/null || { warn "安装 nginx..."; apt_pkg nginx; }
CONF=/etc/nginx/sites-available/vxin
cat > "$CONF" <<NGINX
server {
    listen 80;
    server_name $HOST;
    root $WEBROOT;
    index index.html;
    client_max_body_size 1124m;  # 安全兜底 ~1GB（后端 MAX_UPLOAD_BYTES 精确卡 1GB）
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass         http://127.0.0.1:3002;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
    location /socket.io/ {
        proxy_pass             http://127.0.0.1:3002;
        proxy_http_version     1.1;
        proxy_set_header       Upgrade \$http_upgrade;
        proxy_set_header       Connection "upgrade";
        proxy_set_header       Host \$host;
        proxy_set_header       X-Real-IP \$remote_addr;
        proxy_set_header       X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout     3600s;
    }
    location /uploads/ {
        proxy_pass       http://127.0.0.1:3002;
        proxy_set_header Host \$host;
        expires          7d;
    }
    location /health   { proxy_pass http://127.0.0.1:3002; access_log off; }
    location /download { proxy_pass http://127.0.0.1:3002; }
    location /downloads/ { root /var/www; add_header Cache-Control no-cache; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
ln -sf "$CONF" /etc/nginx/sites-enabled/vxin
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && { systemctl reload nginx 2>/dev/null || service nginx reload; }
ok "nginx 已配置（HTTP）"

# ── [7/8] HTTPS 证书 ────────────────────────────────────────────────
step "7/8 HTTPS 证书"
if [[ -n "$EMAIL" ]]; then
  command -v certbot >/dev/null || apt_pkg certbot python3-certbot-nginx
  if certbot --nginx -d "$HOST" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    ok "HTTPS 已启用"
  else
    warn "证书申请失败（DNS 可能未生效）。域名 DNS 指好后运行:\n  certbot --nginx -d $HOST"
  fi
else
  warn "未提供邮箱，跳过 HTTPS。DNS 指好后运行: certbot --nginx -d $HOST -m 你的邮箱"
fi

# ── [8/8] 监控 & 备份 ───────────────────────────────────────────────
step "8/8 安装监控 & 备份"

# 生成包含 VXIN_ROOT 的系统级命令（解决不同机器 clone 路径不同的问题）
cat > /usr/local/bin/vxin-alert <<WRAPPER
#!/usr/bin/env bash
export VXIN_ROOT="$ROOT"
exec "$ROOT/deploy/vxin-alert.sh" "\$@"
WRAPPER
chmod +x /usr/local/bin/vxin-alert

cat > /usr/local/bin/vxin-backup <<WRAPPER
#!/usr/bin/env bash
export VXIN_ROOT="$ROOT"
exec "$ROOT/deploy/vxin-backup.sh" "\$@"
WRAPPER
chmod +x /usr/local/bin/vxin-backup

# 安装 cron
mkdir -p /var/log/vxin /var/backup/vxin
(crontab -l 2>/dev/null | grep -v "vxin-alert\|vxin-backup" || true
  echo "*/5 * * * * /usr/local/bin/vxin-alert 2>>/var/log/vxin/alert.log"
  echo "0 3 * * *   /usr/local/bin/vxin-backup >> /var/log/vxin/backup.log 2>&1"
) | crontab -

ok "vxin-alert → /usr/local/bin/vxin-alert（每 5 分钟）"
ok "vxin-backup → /usr/local/bin/vxin-backup（每日 03:00）"

[[ -n "${ALERT_BOT_TOKEN:-}" ]] && ok "Telegram 告警已配置（Bot token 已写入 .env）" || \
  warn "未配置 Telegram 告警。部署后在 .env 填写 ALERT_BOT_TOKEN 和 ALERT_CHAT_ID 即可"

# ── 完成汇报 ────────────────────────────────────────────────────────
echo ""
echo -e "${GRN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GRN}║           v信 部署完成                          ║${NC}"
echo -e "${GRN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "  访问地址:  $APP_URL"
echo "  后端健康:  $(curl -sf http://127.0.0.1:3002/health >/dev/null 2>&1 && echo '✅ 正常' || echo '⚠ 请查看 pm2 logs vxin-server-v2')"
echo "  admin 密码: $(cat "$BE/ADMIN_PASSWORD.txt" 2>/dev/null || echo '见 backend-v2/ADMIN_PASSWORD.txt')"
echo ""
echo "  下一步："
echo "    1. DNS 已指向本机 IP 时: certbot --nginx -d $HOST -m ${EMAIL:-你的邮箱}"
echo "    2. 切换所有 App 到新域名: GitHub vxin-config → Actions → 「切换服务器」→ 填 $APP_URL"
echo "    3. 通话 NAT 穿透(可选):   bash deploy/setup-coturn.sh"
echo ""
if [[ -z "${ALERT_BOT_TOKEN:-}" ]]; then
  echo "  可选监控配置（部署后在 .env 填写，填完 pm2 restart vxin-server-v2）:"
  echo "    ALERT_BOT_TOKEN=xxx  # Telegram bot token"
  echo "    ALERT_CHAT_ID=xxx    # Telegram chat id"
  echo "    SENTRY_DSN=https://… # 错误监控"
  echo ""
fi
