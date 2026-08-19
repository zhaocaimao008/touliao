#!/usr/bin/env bash
# ============================================================
# v信 一键部署脚本 —— 在全新服务器上零配置部署
# 用法:  ./deploy/setup.sh <你的域名>
# 示例:  ./deploy/setup.sh chat.example.com
#
# 脚本自动完成：生成 .env（含强随机 JWT_SECRET）、建目录、
# 装依赖、构建前端、写 nginx 配置、启动 pm2。全程无需手改配置。
# 幂等：重复运行安全，已存在的 .env / 密钥会被保留。
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"
PORT="${PORT:-3002}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BE="$ROOT/backend-v2"
WEB="$ROOT/web"
WEBROOT="${WEBROOT:-/var/www/vxin}"
PM2_NAME="touliao-backend"

log(){ printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
die(){ printf '\033[31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "用法: $0 <域名>   例如: $0 chat.example.com"
command -v node >/dev/null || die "未安装 Node.js"
command -v pm2  >/dev/null || die "未安装 pm2（npm i -g pm2）"
command -v nginx >/dev/null || die "未安装 nginx"

# ── 1. 生成后端 .env（缺失才生成，自动强随机密钥）─────────────
ENV="$BE/.env"
if [ ! -f "$ENV" ]; then
  log "生成 $ENV（自动随机 JWT_SECRET）"
  JWT="$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  cat > "$ENV" <<EOF
NODE_ENV=production
PORT=$PORT
DB_PATH=$BE/wechat.db
UPLOADS_ROOT=$BE/uploads
APP_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN,http://$DOMAIN
JWT_SECRET=$JWT
EOF
else
  log ".env 已存在，保留现有配置与密钥（不覆盖）"
fi

mkdir -p "$BE/uploads" "$WEBROOT"

# ── 2. 后端依赖 ───────────────────────────────────────────────
log "安装后端依赖"
cd "$BE"
npm ci --omit=dev 2>/dev/null || npm install --production

# ── 3. 构建前端（相对路径，免域名配置）──────────────────────
log "构建前端"
cd "$WEB"
npm ci 2>/dev/null || npm install
npm run build
cp -r dist/* "$WEBROOT/"

# ── 4. nginx 配置（由模板生成，自动填域名/端口）─────────────
log "写入 nginx 配置"
NGINX_CONF="/etc/nginx/conf.d/vxin.conf"
sed -e "s/__DOMAIN__/$DOMAIN/g" \
    -e "s/__PORT__/$PORT/g" \
    -e "s#__WEBROOT__#$WEBROOT#g" \
    "$ROOT/deploy/nginx.conf.template" > "$NGINX_CONF"
nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload)

# ── 5. 启动后端 ──────────────────────────────────────────────
log "启动后端 (pm2: $PM2_NAME)"
cd "$BE"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start src/server.js --name "$PM2_NAME"
fi
pm2 save

log "✅ 部署完成 → http://$DOMAIN"
log "   申请 HTTPS 证书:  certbot --nginx -d $DOMAIN"
log "   后端日志:         pm2 logs $PM2_NAME"
