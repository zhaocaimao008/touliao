#!/usr/bin/env bash
# ===================================================================
# v信 一键部署脚本（新服务器，一条命令全包）
#
# 用法（在新服务器上，以 root 运行）：
#   git clone https://github.com/zhaocaimao008/vxin-1.0.git
#   cd vxin-1.0
#   bash deploy/setup-new-server.sh https://你的域名.com [你的邮箱(用于HTTPS证书,可选)]
#
# 它会全自动：装依赖 → 生成全新密钥写 .env → pm2 启动后端 →
#            构建网页前端 → 配好 nginx(反代+WebSocket+前端托管) →
#            （给了邮箱则）申请 HTTPS 证书。
# 跑完只剩最后一步：去 vxin-config 仓库 Actions「切换服务器」填本域名。
# ===================================================================
set -euo pipefail

APP_URL="${1:-}"
EMAIL="${2:-}"
if [ -z "$APP_URL" ]; then
  echo "用法: bash deploy/setup-new-server.sh https://你的域名.com [邮箱(HTTPS可选)]"
  exit 1
fi
APP_URL="${APP_URL%/}"
HOST="${APP_URL#https://}"; HOST="${HOST#http://}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BE="$ROOT/backend-v2"
WEBROOT="/var/www/vxin"

apt_install() { command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" || true; }

echo "==> [1/7] 检查环境"
command -v node >/dev/null || { echo "❌ 未装 Node.js，请先装 Node 20+"; exit 1; }
# @aws-sdk/client-s3 等依赖 engines 要求 node>=20（与 CI deploy.yml 一致），18/19 装得上但运行会崩
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "❌ Node 需 ≥20（当前 $(node -v)）"; exit 1; }
command -v npm >/dev/null || { echo "❌ 未装 npm"; exit 1; }
command -v pm2 >/dev/null || { echo "   装 pm2..."; npm i -g pm2; }
command -v make >/dev/null && command -v g++ >/dev/null || { echo "   装编译工具..."; apt_install build-essential python3; }

echo "==> [2/7] 安装后端依赖"
cd "$BE"; npm ci

if [ ! -f .env ]; then
  echo "==> [3/7] 生成 .env（全新随机密钥）"
  JWT="$(openssl rand -hex 48)"; AJWT="$(openssl rand -hex 48)"
  APW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  read -r VPUB VPRIV < <(node -e "const w=require('web-push');const k=w.generateVAPIDKeys();process.stdout.write(k.publicKey+' '+k.privateKey)")
  cat > .env <<EOF
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
# ⚠️  安全加固（部署后手动填写以下两项）:
# ADMIN_IP_WHITELIST=<你的IP>         # 限制管理后台访问 IP（逗号分隔多个）
# SENTRY_DSN=https://xxx@sentry.io/xxx  # 错误监控（可选）
EOF
  echo "$APW" > ADMIN_PASSWORD.txt
  echo "   ✅ admin 密码已存 $BE/ADMIN_PASSWORD.txt"
  echo ""
  echo "   ⚠️  安全提醒：请在 .env 中设置 ADMIN_IP_WHITELIST=<你的IP>"
  echo "      否则管理后台对外网开放！"
else
  echo "==> [3/7] 已有 .env，跳过（不覆盖）"
fi

echo "==> [4/7] 启动后端 (pm2)"
pm2 start ecosystem.config.js --update-env 2>/dev/null || pm2 restart vxin-server-v2 --update-env
pm2 save || true
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true   # 开机自启

echo "==> [5/7] 构建网页前端并部署"
cd "$ROOT/web"; npm ci; npm run build
mkdir -p "$WEBROOT"; rm -rf "${WEBROOT:?}/"*; cp -r dist/* "$WEBROOT"/
echo "   ✅ 前端已部署到 $WEBROOT"

echo "==> [6/7] 配置 nginx"
command -v nginx >/dev/null || { echo "   装 nginx..."; apt_install nginx; }
CONF=/etc/nginx/sites-available/vxin
cat > "$CONF" <<NGINX
server {
    listen 80;
    server_name $HOST;
    root $WEBROOT;
    index index.html;
    client_max_body_size 50m;

    location /api/      { proxy_pass http://127.0.0.1:3002; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }
    location /uploads/  { proxy_pass http://127.0.0.1:3002; proxy_set_header Host \$host; }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
    location /admin/ { alias $ROOT/admin/; index index.html; try_files \$uri \$uri/ /admin/index.html; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
ln -sf "$CONF" /etc/nginx/sites-enabled/vxin
[ -e /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default || true
nginx -t && { systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || service nginx reload; }
echo "   ✅ nginx 已配置并加载（HTTP）"

echo "==> [7/7] HTTPS 证书"
if [ -n "$EMAIL" ]; then
  command -v certbot >/dev/null || apt_install certbot python3-certbot-nginx
  if certbot --nginx -d "$HOST" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    echo "   ✅ HTTPS 已启用"
  else
    echo "   ⚠ 证书申请失败（多半是域名 DNS 还没指到本机）。DNS 生效后再跑: certbot --nginx -d $HOST"
  fi
else
  echo "   ⏭ 未提供邮箱，跳过 HTTPS。DNS 指好后运行: certbot --nginx -d $HOST"
fi

echo ""
echo "============================================================"
echo "✅ 部署完成。后端 + 前端 + nginx 都就绪。"
curl -fs http://127.0.0.1:3002/health >/dev/null 2>&1 && echo "   后端健康检查: 通过" || echo "   ⚠ 后端健康检查未过，看 pm2 logs vxin-server-v2"
echo ""
echo "最后一步（让所有 App 连过来）："
echo "  GitHub → vxin-config 仓库 → Actions →「切换服务器」→ 填 $APP_URL → Run"
echo ""
echo "通话要能接通：装 coturn，见 backend-v2/docs/COTURN_SETUP.md"
echo "============================================================"
