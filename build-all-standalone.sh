#!/bin/bash

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BUILD_DIR="/root/v信"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/build_standalone_${TIMESTAMP}.log"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   v2.2.1 跨平台构建                        ║${NC}"
echo -e "${BLUE}║   Windows + iOS                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "日志: $LOG_FILE"
echo ""

# ============ Web 构建 ============
echo -e "${YELLOW}=== 步骤 1/3: 构建 Web ===${NC}"
cd "$BUILD_DIR/web"
npm run build -- --mode desktop 2>&1 | tee -a "$LOG_FILE" | tail -10
echo -e "${GREEN}[✓]${NC} Web v2.2.1 构建完成"
echo ""

# ============ Windows 构建 ============
echo -e "${YELLOW}=== 步骤 2/3: 构建 Windows EXE ===${NC}"
cd "$BUILD_DIR/desktop-electron"

export CSC_IDENTITY_AUTO_DISCOVERY=false
export WIN_CSC_LINK=""
export WIN_CSC_KEY_PASSWORD=""
export ELECTRON_BUILDER_SKIP_RECODE_SIGNING=true

echo "安装 Electron 依赖..."
npm ci 2>&1 | tee -a "$LOG_FILE" | tail -5

echo "使用 electron-builder 构建 Windows..."
npx electron-builder --win --x64 --publish=never 2>&1 | tee -a "$LOG_FILE" | tail -50

# 检查输出
if ls dist/vxin-*.exe 2>/dev/null | head -1; then
    echo -e "${GREEN}[✓]${NC} Windows EXE 构建成功"
    ls -lh dist/vxin-*.exe | head -3
else
    echo -e "${YELLOW}[!]${NC} Windows EXE 可能在构建中或需要额外处理"
fi

echo ""

# ============ iOS 构建 ============
echo -e "${YELLOW}=== 步骤 3/3: 构建 iOS IPA ===${NC}"

if command -v xcodebuild &> /dev/null; then
    echo -e "${GREEN}[✓]${NC} 检测到 Xcode"
    
    cd "$BUILD_DIR/ios"
    
    if command -v xcodegen &> /dev/null; then
        echo "生成 Xcode 工程..."
        xcodegen generate 2>&1 | tee -a "$LOG_FILE" | tail -10
        
        echo "构建 iOS Release 包..."
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
        echo -e "${YELLOW}[!]${NC} xcodegen 未安装，正在安装..."
        brew install xcodegen 2>&1 | tee -a "$LOG_FILE"
    fi
else
    echo -e "${YELLOW}[i]${NC} macOS/Xcode 环境未检测到"
    echo "    iOS 构建需要在 macOS 系统上执行:"
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

echo "📦 可部署文件:"
echo ""

# Web
if [ -d "$BUILD_DIR/web/dist" ]; then
    size=$(du -sh "$BUILD_DIR/web/dist" | cut -f1)
    echo -e "  ${GREEN}✓${NC} Web v2.2.1        : $size"
fi

# Windows
if ls "$BUILD_DIR/desktop-electron/dist/"vxin-*.exe 2>/dev/null | grep -q .; then
    win_exe=$(ls -lh "$BUILD_DIR/desktop-electron/dist/"vxin-*.exe 2>/dev/null | head -1 | awk '{print $NF, "(" $5 ")"}')
    echo -e "  ${GREEN}✓${NC} Windows v2.2.1    : $win_exe"
else
    echo -e "  ${YELLOW}?${NC} Windows v2.2.1    : 检查输出目录"
fi

# iOS
if [ -f "$BUILD_DIR/ios/build/Vxin.ipa" ]; then
    ios_size=$(ls -lh "$BUILD_DIR/ios/build/Vxin.ipa" | awk '{print $5}')
    echo -e "  ${GREEN}✓${NC} iOS v2.2.1        : $ios_size"
else
    echo -e "  ${YELLOW}?${NC} iOS v2.2.1        : 需在 macOS 上构建"
fi

# Android
if [ -f "$BUILD_DIR/android/app/build/outputs/apk/release/app-release-unsigned.apk" ]; then
    android_size=$(ls -lh "$BUILD_DIR/android/app/build/outputs/apk/release/app-release-unsigned.apk" | awk '{print $5}')
    echo -e "  ${GREEN}✓${NC} Android v2.2.1    : $android_size (APK)"
fi

echo ""
echo "📝 日志文件: $LOG_FILE"

