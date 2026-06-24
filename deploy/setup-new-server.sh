#!/usr/bin/env bash
# ===================================================================
# v信 一键部署脚本（新服务器）
#
# 用法（在新服务器上，先 git clone 本仓库，然后）：
#   bash deploy/setup-new-server.sh https://你的域名.com
#
# 它会：装依赖 → 自动生成全新随机密钥写好 .env → 用 pm2 启动后端。
# nginx + HTTPS + 前端托管是一次性手动步骤，脚本末尾会打印指引。
# ===================================================================
set -euo pipefail

APP_URL="${1:-}"
if [ -z "$APP_URL" ]; then
  echo "用法: bash deploy/setup-new-server.sh https://你的域名.com"
  exit 1
fi
APP_URL="${APP_URL%/}"                       # 去掉结尾斜杠
HOST="${APP_URL#https://}"; HOST="${HOST#http://}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BE="$ROOT/backend-v2"

echo "==> [1/5] 检查环境"
command -v node >/dev/null || { echo "❌ 未装 Node.js，请先安装 Node 18+"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "❌ Node 版本过低（需 ≥18，当前 $(node -v)）"; exit 1; }
command -v npm >/dev/null || { echo "❌ 未装 npm"; exit 1; }
if ! command -v pm2 >/dev/null; then echo "   安装 pm2..."; npm i -g pm2; fi
# better-sqlite3 需要编译工具
command -v make >/dev/null && command -v g++ >/dev/null || \
  echo "⚠ 未检测到 g++/make，若 npm ci 失败请先: apt install -y build-essential python3"

echo "==> [2/5] 安装后端依赖"
cd "$BE"
npm ci

if [ ! -f .env ]; then
  echo "==> [3/5] 生成 .env（含全新随机密钥，绝不沿用历史泄露值）"
  JWT="$(openssl rand -hex 48)"
  AJWT="$(openssl rand -hex 48)"
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
EOF
  echo "$APW" > ADMIN_PASSWORD.txt
  echo "   ✅ 已写 .env；后台管理员账号 admin / 密码见 $BE/ADMIN_PASSWORD.txt"
else
  echo "==> [3/5] 已存在 .env，跳过（不覆盖你现有配置）"
fi

echo "==> [4/5] 启动后端 (pm2)"
pm2 start ecosystem.config.js --update-env 2>/dev/null || pm2 restart vxin-server-v2 --update-env
pm2 save || true

echo "==> [5/5] 健康检查"
sleep 2
if curl -fs http://127.0.0.1:3002/health >/dev/null 2>&1; then
  echo "   ✅ 后端已在 127.0.0.1:3002 运行正常"
else
  echo "   ⚠ 健康检查未通过，看日志: pm2 logs vxin-server-v2"
fi

cat <<TIP

============================================================
后端已就绪。剩下一次性手动步骤：

1) nginx 反代到 127.0.0.1:3002（支持 WebSocket）。
   参考样例: $ROOT/deploy/nginx-vxin.conf.example （把域名改成 $HOST）

2) 申请 HTTPS 证书:
     apt install -y certbot python3-certbot-nginx
     certbot --nginx -d $HOST

3) 部署网页前端（同域托管，零额外配置）:
     cd $ROOT/web && npm ci && npm run build
     # 把 web/dist/ 交给 nginx 在 $APP_URL 根路径托管

4) 通话要能接通：装 coturn，见 backend-v2/docs/COTURN_SETUP.md

5) 最后一步让全端连过来：去 GitHub 的 vxin-config 仓库 → Actions →
   「切换服务器」→ 填 $APP_URL → Run。几分钟后所有 App 自动连到这里。
============================================================
TIP
