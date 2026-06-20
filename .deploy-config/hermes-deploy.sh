#!/bin/bash
# Hermes 一键部署脚本 - 通过 Hermes 连接到香港服务器

set -e

echo "🚀 开始通过 Hermes 部署..."

# 提示用户输入必要信息
read -p "请输入香港服务器 IP：" SERVER_IP
read -p "请输入 SSH 用户名（默认: root）：" SERVER_USER
SERVER_USER=${SERVER_USER:-root}

echo ""
echo "=========================================="
echo "🔧 配置信息"
echo "=========================================="
echo "服务器: $SERVER_USER@$SERVER_IP"
echo ""

# 获取公钥
PUBLIC_KEY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/keys/vxin-deploy.pub"
PUBLIC_KEY=$(cat "$PUBLIC_KEY_FILE")

# 步骤 1: 在服务器上添加公钥
echo "📋 步骤 1: 在服务器上添加公钥..."

hermes send << EOF
在以下服务器上添加公钥到 ~/.ssh/authorized_keys

服务器: $SERVER_USER@$SERVER_IP

执行以下命令：
mkdir -p ~/.ssh
chmod 700 ~/.ssh

cat >> ~/.ssh/authorized_keys << 'PUBKEY'
$PUBLIC_KEY
PUBKEY

chmod 600 ~/.ssh/authorized_keys

echo "✅ 公钥已添加"
EOF

echo ""

# 步骤 2: 创建必要的目录
echo "📋 步骤 2: 在服务器上创建目录结构..."

hermes send << EOF
在服务器 $SERVER_USER@$SERVER_IP 上运行：

mkdir -p ~/.ssh
mkdir -p /root/v信/backend-v2
mkdir -p /var/lib/vxin/logs
mkdir -p /var/lib/vxin/uploads
mkdir -p /var/lib/vxin/db

echo "✅ 目录已创建"
EOF

echo ""

# 步骤 3: 克隆或更新代码
echo "📋 步骤 3: 克隆应用代码..."

hermes send << EOF
在服务器 $SERVER_USER@$SERVER_IP 上运行：

if [ ! -d "/root/v信" ]; then
    git clone https://github.com/zhaocaimao008/vxin-1.0.git /root/v信
else
    cd /root/v信
    git fetch origin
    git checkout main
fi

echo "✅ 代码已准备"
EOF

echo ""
echo "=========================================="
echo "✅ 服务器配置完成！"
echo "=========================================="
echo ""
echo "后续步骤:"
echo "1. 在 GitHub 添加 3 个 Secrets（见下面的说明）"
echo "2. 推送代码: git push origin main"
echo "3. 查看 GitHub Actions 自动部署"
echo ""

