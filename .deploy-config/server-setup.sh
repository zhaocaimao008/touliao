#!/bin/bash
# V信后端服务器部署前配置脚本
# 在香港服务器上运行此脚本

set -e

echo "=========================================="
echo "V信后端服务器配置"
echo "=========================================="
echo ""

# 1. 创建目录结构
echo "[1/4] 创建目录结构..."
mkdir -p ~/.ssh
mkdir -p /root/v信/backend-v2
mkdir -p /var/lib/vxin/logs
mkdir -p /var/lib/vxin/uploads
mkdir -p /var/lib/vxin/db

echo "✅ 目录已创建"
echo ""

# 2. 配置 SSH
echo "[2/4] 配置 SSH..."

# 创建 authorized_keys（如果不存在）
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

echo "✅ SSH 配置完成"
echo ""

# 3. 检查必要工具
echo "[3/4] 检查必要工具..."

if ! command -v git &> /dev/null; then
    echo "❌ Git 未安装"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm 未安装"
    exit 1
fi

echo "✅ 所有必要工具已安装"
echo ""

# 4. 克隆或更新代码
echo "[4/4] 准备应用代码..."

if [ ! -d "/root/v信" ]; then
    echo "克隆仓库..."
    git clone https://github.com/zhaocaimao008/vxin-1.0.git /root/v信
else
    echo "更新仓库..."
    cd /root/v信
    git fetch origin
fi

echo "✅ 应用代码已准备"
echo ""

echo "=========================================="
echo "✅ 服务器配置完成！"
echo "=========================================="
echo ""
echo "后续步骤:"
echo "1. 添加公钥到 ~/.ssh/authorized_keys"
echo "2. 在 GitHub 添加 3 个 Secrets"
echo "3. 推送代码到 main 分支"
echo ""

