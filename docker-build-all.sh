#!/bin/bash

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BUILD_DIR="/root/v信"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/docker_build_${TIMESTAMP}.log"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Docker 跨平台构建 v2.2.1                 ║${NC}"
echo -e "${BLUE}║   Windows + iOS                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "日志: $LOG_FILE"

# ============ Windows 构建 ============
echo -e "${YELLOW}=== 第 1 步: 准备 Windows 构建环境 ===${NC}"

cat > /tmp/Dockerfile.windows << 'DOCKERFILE'
FROM node:20-alpine

# 安装构建工具
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

WORKDIR /build

# 复制整个项目
COPY . /build/

# 构建 Web
WORKDIR /build/web
RUN npm ci && npm run build -- --mode desktop

# 构建 Electron Windows
WORKDIR /build/desktop-electron
RUN npm ci

# 设置环境变量禁用代码签名
ENV CSC_IDENTITY_AUTO_DISCOVERY=false \
    WIN_CSC_LINK="" \
    WIN_CSC_KEY_PASSWORD="" \
    ELECTRON_BUILDER_SKIP_RECODE_SIGNING=true

# 构建 Windows
RUN npx electron-builder --win --x64 --publish=never 2>&1 | tee /tmp/build.log || true

# 检查输出
RUN find dist -type f \( -name "*.exe" -o -name "*.nsis*" -o -name "*.msi" \) -ls 2>/dev/null || echo "检查输出目录..."
RUN ls -lh dist/ | grep -E "vxin|setup"

DOCKERFILE

echo "构建 Docker 镜像 (Windows 环境)..."
docker build -f /tmp/Dockerfile.windows -t vxin-windows-builder:latest "$BUILD_DIR" 2>&1 | tee -a "$LOG_FILE" | tail -50

echo ""
echo -e "${GREEN}[✓]${NC} 提取 Windows 构建文件..."

# 提取文件
CONTAINER_ID=$(docker create vxin-windows-builder:latest)
docker cp "$CONTAINER_ID:/build/desktop-electron/dist/" /tmp/windows-artifacts-$$ 2>&1 | tee -a "$LOG_FILE"

# 复制到最终位置
if [ -d "/tmp/windows-artifacts-$$" ]; then
    echo -e "${GREEN}[✓]${NC} 找到 Windows 构建输出"
    ls -lh /tmp/windows-artifacts-$$/
    
    # 复制 EXE 文件
    find /tmp/windows-artifacts-$$/ -type f \( -name "*.exe" -o -name "*.nsis*" \) -exec cp {} "$BUILD_DIR/desktop-electron/dist/" \; 2>/dev/null || true
fi

docker rm "$CONTAINER_ID" 2>&1 >> "$LOG_FILE"
rm -rf /tmp/windows-artifacts-$$

echo ""

# ============ iOS 准备 ============
echo -e "${YELLOW}=== 第 2 步: 准备 iOS 构建 ===${NC}"

if command -v xcodebuild &> /dev/null; then
    echo -e "${GREEN}[✓]${NC} 检测到 Xcode"
    
    # 在 macOS 上直接构建
    cd "$BUILD_DIR/ios"
    
    echo "生成 Xcode 工程..."
    if command -v xcodegen &> /dev/null; then
        xcodegen generate 2>&1 | tee -a "$LOG_FILE"
        
        echo "构建 iOS Release..."
        xcodebuild -scheme Vxin -configuration Release \
            -archivePath build/Vxin.xcarchive archive 2>&1 | tee -a "$LOG_FILE" | tail -30
        
        echo "导出 IPA..."
        xcodebuild -exportArchive \
            -archivePath build/Vxin.xcarchive \
            -exportOptionsPlist export-options.plist \
            -exportPath build/ 2>&1 | tee -a "$LOG_FILE" | tail -30
        
        if [ -f "build/Vxin.ipa" ]; then
            echo -e "${GREEN}[✓]${NC} iOS IPA 构建成功"
            ls -lh build/Vxin.ipa
        fi
    else
        echo -e "${YELLOW}[i]${NC} 需要安装 xcodegen"
        brew install xcodegen
    fi
else
    echo -e "${YELLOW}[i]${NC} macOS 环境未检测到"
    echo "    iOS 构建需要在 macOS 上执行以下命令:"
    echo ""
    echo "    cd $BUILD_DIR/ios"
    echo "    xcodegen generate"
    echo "    xcodebuild -scheme Vxin -configuration Release -archivePath build/Vxin.xcarchive archive"
    echo "    xcodebuild -exportArchive -archivePath build/Vxin.xcarchive -exportOptionsPlist export-options.plist -exportPath build/"
fi

echo ""

# ============ 总结 ============
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         构建完成总结                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# 检查输出文件
if ls "$BUILD_DIR/desktop-electron/dist/"*.exe 2>/dev/null | grep -q vxin; then
    echo -e "${GREEN}✓ Windows EXE${NC}"
    ls -lh "$BUILD_DIR/desktop-electron/dist/"*.exe 2>/dev/null || true
else
    echo -e "${YELLOW}? Windows EXE${NC} - 检查输出目录"
fi

if [ -f "$BUILD_DIR/ios/build/Vxin.ipa" ]; then
    echo -e "${GREEN}✓ iOS IPA${NC}"
    ls -lh "$BUILD_DIR/ios/build/Vxin.ipa"
else
    echo -e "${YELLOW}? iOS IPA${NC} - 需在 macOS 上构建"
fi

echo ""
echo "日志文件: $LOG_FILE"

