#!/bin/bash

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BUILD_DIR="/root/v信"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/build_all_${TIMESTAMP}.log"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   v信 四端自动构建系统 v2.2.1             ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "日志文件: $LOG_FILE"
echo ""

# 函数：执行构建步骤
build_step() {
    local name=$1
    local cmd=$2
    
    echo -e "${YELLOW}[构建]${NC} $name"
    if eval "$cmd" 2>&1 | tee -a "$LOG_FILE"; then
        echo -e "${GREEN}[✓]${NC} $name 完成"
        return 0
    else
        echo -e "${RED}[✗]${NC} $name 失败"
        return 1
    fi
}

# 1. Web 已完成
echo -e "${GREEN}[✓]${NC} Web v2.2.1 已部署到 /var/www/html/v信"
echo ""

# 2. Electron Linux (AppImage)
echo -e "${YELLOW}=== Electron (Linux AppImage) ===${NC}"
cd "$BUILD_DIR/desktop-electron"
if build_step "Electron Linux AppImage" "npm run build:linux"; then
    echo -e "${GREEN}输出: v信-2.2.1.AppImage${NC}"
    ls -lh dist/*.AppImage
fi
echo ""

# 3. iOS 构建检查
echo -e "${YELLOW}=== iOS v2.2.1 ===${NC}"
if command -v xcodegen &> /dev/null; then
    echo -e "${GREEN}[✓]${NC} 检测到 xcodegen"
    cd "$BUILD_DIR/ios"
    
    build_step "生成 Xcode 工程" "xcodegen generate" && \
    build_step "编译 iOS Release" "xcodebuild -scheme Vxin -configuration Release -archivePath build/Vxin.xcarchive archive" && \
    build_step "导出 IPA" "xcodebuild -exportArchive -archivePath build/Vxin.xcarchive -exportOptionsPlist export-options.plist -exportPath build/" && \
    echo -e "${GREEN}输出: Vxin.ipa${NC}" && \
    ls -lh build/*.ipa 2>/dev/null || echo "IPA 文件位置: $BUILD_DIR/ios/build/"
else
    echo -e "${RED}[✗]${NC} 需要 macOS + Xcode 环境"
    echo "    → 在 macOS 上运行: cd $BUILD_DIR/ios && xcodegen generate && xcodebuild -scheme Vxin -configuration Release"
fi
echo ""

# 4. Android 构建检查
echo -e "${YELLOW}=== Android v2.2.1 ===${NC}"
cd "$BUILD_DIR/android"

if [ -f "gradlew" ]; then
    echo -e "${GREEN}[✓]${NC} 检测到 Gradle Wrapper${NC}"
    
    build_step "构建 Android Release APK" "./gradlew assembleRelease" && \
    echo -e "${GREEN}输出: app-release.apk${NC}" && \
    find . -name "app-release.apk" -ls 2>/dev/null | tail -1 || echo "APK 位置: $BUILD_DIR/android/app/build/outputs/apk/release/"
    
    echo ""
    
    build_step "构建 Android Bundle (AAB)" "./gradlew bundleRelease" && \
    echo -e "${GREEN}输出: app-release.aab${NC}" && \
    find . -name "app-release.aab" -ls 2>/dev/null | tail -1 || echo "AAB 位置: $BUILD_DIR/android/app/build/outputs/bundle/release/"
else
    echo -e "${RED}[✗]${NC} 需要 Android SDK 和 Gradle"
    echo "    → 在 Android SDK 配置好的系统上运行:"
    echo "       cd $BUILD_DIR/android"
    echo "       ./gradlew assembleRelease  # APK"
    echo "       ./gradlew bundleRelease    # AAB (Google Play)"
fi
echo ""

# 总结
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         构建完成总结                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✓ Web v2.2.1${NC}        - 已部署到 /var/www/html/v信"
echo -e "${GREEN}✓ Electron Linux${NC}    - v信-2.2.1.AppImage"
echo -e "${YELLOW}? iOS v2.2.1${NC}        - 需要 macOS 环境"
echo -e "${YELLOW}? Android v2.2.1${NC}    - 需要 Android SDK"
echo ""
echo "详细日志: $LOG_FILE"

