#!/usr/bin/env bash
# ============================================================
# 投聊 一键部署脚本 —— 在全新服务器上零配置部署
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
WEBROOT="${WEBROOT:-/var/www/touliao}"
PM2_NAME="touliao-backend"

log(){ printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
die(){ printf '\033[31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "用法: $0 <域名>   例如: $0 chat.example.com"
command -v node >/dev/null || die "未安装 Node.js"
command -v pm2  >/dev/null || die "未安装 pm2（npm i -g pm2）"
command -v nginx >/dev/null || die "未安装 nginx"

# ── 1. 生成后端 .env（缺失才生成，自动强随机密钥）─────────────
# 注：config/index.js 在 NODE_ENV=production 下，ADMIN_JWT_SECRET 缺失会在加载配置时
# 直接 throw 中止启动；ADMIN_USERNAME/ADMIN_PASSWORD 缺失同样致命报错退出（长度<12也不行）。
# 此前本脚本只生成了 JWT_SECRET，三个必填项全漏——照着本脚本走完三步部署，
# pm2 起来的进程会立即崩溃退出（见 AUDIT.md 十六节）。这里补齐，风格与
# deploy/setup-new-server.sh 已验证过的生成方式保持一致。
ENV="$BE/.env"
if [ ! -f "$ENV" ]; then
  log "生成 $ENV（自动随机 JWT_SECRET / ADMIN_JWT_SECRET / 管理员账号）"
  JWT="$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  AJWT="$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  ADMIN_PW="$(openssl rand -base64 18 2>/dev/null | tr -d '/+=' | cut -c1-20 || node -e "console.log(require('crypto').randomBytes(18).toString('base64').replace(/[\/+=]/g,'').slice(0,20))")"

  # 自动检测当前 SSH 客户端 IP 作为 admin 白名单（留空则后台不限制来源 IP，不阻断部署）
  AUTO_IP=""
  if [ -n "${SSH_CLIENT:-}" ]; then
    AUTO_IP=$(echo "$SSH_CLIENT" | awk '{print $1}')
  elif [ -n "${SSH_CONNECTION:-}" ]; then
    AUTO_IP=$(echo "$SSH_CONNECTION" | awk '{print $1}')
  fi
  ADMIN_WL="${ADMIN_IP_WHITELIST:-${AUTO_IP:-}}"

  cat > "$ENV" <<EOF
NODE_ENV=production
PORT=$PORT
DB_PATH=$BE/wechat.db
UPLOADS_ROOT=$BE/uploads
APP_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN,http://$DOMAIN
JWT_SECRET=$JWT
ADMIN_JWT_SECRET=$AJWT
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PW
ADMIN_IP_WHITELIST=$ADMIN_WL
EOF

  echo "$ADMIN_PW" > "$BE/ADMIN_PASSWORD.txt"
  chmod 600 "$ENV" "$BE/ADMIN_PASSWORD.txt"
  log "✅ admin 密码: $ADMIN_PW（已存 backend-v2/ADMIN_PASSWORD.txt，权限600）"
  if [ -n "$ADMIN_WL" ]; then
    log "ADMIN_IP_WHITELIST=$ADMIN_WL（自动检测到的当前 SSH IP）"
  else
    log "⚠ 未检测到 SSH IP，管理后台暂不限制来源 IP，建议部署后手动在 .env 设置 ADMIN_IP_WHITELIST"
  fi
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
NGINX_CONF="/etc/nginx/conf.d/touliao.conf"
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
