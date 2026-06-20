#!/usr/bin/env bash
# ============================================================================
# vxin 远程配置服务器部署脚本
# ============================================================================
# 在 93.179.127.50 上执行一次，配置 config.dipsin.com 的静态文件服务器。
#
# 用法：
#   chmod +x deploy-config.sh
#   sudo bash deploy-config.sh
#
# 完成后上传 config.json 到 /var/www/config/config.json 即可生效，
# 所有客户端下次启动时自动读取新配置。
# ============================================================================
set -euo pipefail

DOMAIN="config.dipsin.com"
ROOT="/var/www/config"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

echo "══════════════════════════════════════════════"
echo "  Deploy: ${DOMAIN}"
echo "══════════════════════════════════════════════"
echo ""

# ── 1. 创建目录 ──────────────────────────────────────────────
echo "◆ 创建目录 ${ROOT}..."
mkdir -p "${ROOT}"

# ── 2. 创建初始 config.json ──────────────────────────────────
echo "◆ 创建 ${ROOT}/config.json..."
cat > "${ROOT}/config.json" <<'CONFIG_EOF'
{
  "api":    "https://api.dipsin.com",
  "socket": "https://ws.dipsin.com",
  "cdn":    "https://cdn.dipsin.com",
  "upload": "https://api.dipsin.com",
  "version":"2.0.1"
}
CONFIG_EOF
echo "  写入完成"

# ── 3. 生成 Nginx 配置 ─────────────────────────────────────────
echo "◆ 生成 Nginx 配置 ${NGINX_CONF}..."

# 检测是否已存在证书（判断是否已跑过 certbot）
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [ -d "${CERT_DIR}" ]; then
  echo "  检测到已有证书，启用 HTTPS..."
  cat > "${NGINX_CONF}" <<NGINX_EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    root ${ROOT};
    index index.html index.json;

    location / {
        try_files \$uri \$uri/ =404;
    }

    # 允许跨域（所有 vxin 客户端都要读取）
    location /config.json {
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, OPTIONS";
        add_header Access-Control-Allow-Headers "Content-Type";
        add_header Cache-Control "public, max-age=300";
        try_files \$uri =404;
    }

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log  /var/log/nginx/${DOMAIN}.error.log;
}
NGINX_EOF
else
  echo "  未检测到证书，使用 HTTP（等待 certbot）..."
  cat > "${NGINX_CONF}" <<NGINX_EOF
server {
    listen 80;
    server_name ${DOMAIN};

    root ${ROOT};
    index index.html index.json;

    location / {
        try_files \$uri \$uri/ =404;
    }

    # 允许跨域
    location /config.json {
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, OPTIONS";
        add_header Access-Control-Allow-Headers "Content-Type";
        add_header Cache-Control "public, max-age=300";
        try_files \$uri =404;
    }

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log  /var/log/nginx/${DOMAIN}.error.log;
}
NGINX_EOF
fi

# ── 4. 启用站点 ──────────────────────────────────────────────
echo "◆ 启用站点..."
ln -sf "${NGINX_CONF}" "${NGINX_ENABLED}" 2>/dev/null || true
nginx -t && systemctl reload nginx || echo "  ⚠ nginx 检查失败，请手动排查"

# ── 5. 申请 SSL ──────────────────────────────────────────────
echo ""
echo "◆ 申请 SSL 证书..."
if command -v certbot &>/dev/null; then
  echo "  已安装 certbot"
  if [ ! -d "${CERT_DIR}" ]; then
    echo "  执行: certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m admin@dipsin.com"
    echo "  ⚠ 首次执行可能需要交互。上面的命令可直接复制执行。"
  else
    echo "  证书已存在，跳过"
  fi
else
  echo "  certbot 未安装，请先安装："
  echo "    apt install -y certbot python3-certbot-nginx"
  echo "  然后执行："
  echo "    certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m admin@dipsin.com"
fi

# ── 6. 验证 ──────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "  部署信息"
echo "══════════════════════════════════════════════"
echo ""
echo "  目录:    ${ROOT}/"
echo "  URL:     https://${DOMAIN}/config.json"
echo "  Nginx:   ${NGINX_CONF}"
echo ""
echo "  文件:"
ls -lh "${ROOT}/"
echo ""
echo "  Nginx 状态:"
nginx -t 2>&1 || true
echo ""
echo "══════════════════════════════════════════════"
echo "  手动部署命令（如果没有自动执行）"
echo "══════════════════════════════════════════════"
echo ""
echo "  # 上传配置到服务器"
echo "  scp /root/v信/release/config.example.json root@93.179.127.50:${ROOT}/config.json"
echo ""
echo "  # 测试配置可访问"
echo "  curl -s ${DOMAIN}/config.json"
echo ""
echo "  # 如需严格域名，修改 config.json 中的 api/socket/cdn 后重新部署"
echo ""
