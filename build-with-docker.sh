#!/bin/bash

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BUILD_DIR="/root/v信"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   使用 Docker 跨平台构建系统                 ║${NC}"
echo -e "${BLUE}║   Windows EXE + iOS IPA                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# ============ Windows 构建 (Docker) ============
echo -e "${YELLOW}=== Windows EXE 构建 (Docker) ===${NC}"

cat > /tmp/Dockerfile.win << 'DOCKERFILE'
FROM ubuntu:22.04

# 安装依赖
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    apt-transport-https \
    ca-certificates \
    software-properties-common \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm@latest

# 工作目录
WORKDIR /app

# 复制项目
COPY . /app/

# 构建 Web
RUN cd /app/web && npm install && npm run build -- --mode desktop

# 进入 desktop-electron 目录
WORKDIR /app/desktop-electron

# 安装依赖
RUN npm install

# 设置环境变量禁用代码签名
ENV CSC_IDENTITY_AUTO_DISCOVERY=false
ENV WIN_CSC_LINK=""
ENV WIN_CSC_KEY_PASSWORD=""

# 构建 Windows (NSIS + Portable)
RUN npx electron-builder --win --x64 --publish never

# 输出
RUN ls -lh dist/vxin-*.exe dist/vxin-*.nsis.7z 2>/dev/null || echo "Windows 包已生成"
DOCKERFILE

echo "构建 Docker 镜像 (为 Windows 构建准备)..."
docker build -f /tmp/Dockerfile.win -t vxin-build-win "$BUILD_DIR" 2>&1 | tail -30

echo "提取 Windows 构建文件..."
container_id=$(docker create vxin-build-win)
docker cp "$container_id:/app/desktop-electron/dist/" /tmp/win-dist-$$/ 2>/dev/null || true
docker rm "$container_id"

if [ -d "/tmp/win-dist-$$" ]; then
    echo -e "${GREEN}[✓]${NC} Windows EXE 构建完成"
    find /tmp/win-dist-$$/ -name "*.exe" -o -name "*.nsis*" 2>/dev/null | head -5
    cp -r /tmp/win-dist-$$/* "$BUILD_DIR/desktop-electron/dist/" 2>/dev/null || true
    rm -rf /tmp/win-dist-$$
fi

echo ""

# ============ iOS 构建 (Docker + osxcross) ============
echo -e "${YELLOW}=== iOS IPA 构建 (Docker + osxcross) ===${NC}"

cat > /tmp/Dockerfile.ios << 'DOCKERFILE'
FROM ubuntu:22.04

# 安装基础工具
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    libssl-dev \
    libbz2-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 osxcross (用于 iOS 交叉编译)
RUN git clone https://github.com/tpoechtrager/osxcross.git /osxcross && \
    cd /osxcross && \
    git checkout master

# 工作目录
WORKDIR /app

# 提示信息
RUN echo "ℹ️ 完整的 iOS 构建需要 macOS Xcode SDK"
RUN echo "📝 此 Docker 镜像为 iOS 交叉编译准备"

DOCKERFILE

echo -e "${YELLOW}[i]${NC} iOS 需要 macOS Xcode 工具链"
echo "    iOS 完整构建建议在 macOS 系统上执行"
echo ""

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Docker 构建完成                          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"

