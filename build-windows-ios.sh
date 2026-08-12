#!/bin/bash

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BUILD_DIR="/root/v信"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/build_win_ios_${TIMESTAMP}.log"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Windows + iOS 跨平台构建系统              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# ============ Windows 构建 ============
echo -e "${YELLOW}=== Windows EXE 构建 ===${NC}"
echo "检查 Wine 环境..."

if command -v wine64 &> /dev/null; then
    echo -e "${GREEN}[✓]${NC} Wine 已安装"
    cd "$BUILD_DIR/desktop-electron"
    echo "开始构建 Windows EXE..."
    npm run build:win 2>&1 | tee -a "$LOG_FILE"
    if [ -f "dist/vxin-2.2.1-setup.exe" ]; then
        echo -e "${GREEN}[✓]${NC} Windows EXE 构建成功"
        ls -lh dist/vxin-2.2.1-setup.exe
    fi
else
    echo -e "${YELLOW}[i]${NC} Wine 未安装，尝试安装..."
    
    # 检测系统
    if command -v dnf &> /dev/null; then
        echo "检测到 DNF (Red Hat/CentOS/AlmaLinux)"
        echo "安装 Wine..."
        sudo dnf install -y wine-core wine-staging wine-gecko wine-mono 2>&1 | tee -a "$LOG_FILE"
    elif command -v apt &> /dev/null; then
        echo "检测到 APT (Debian/Ubuntu)"
        echo "安装 Wine..."
        sudo apt-get update && sudo apt-get install -y wine wine32 wine64 2>&1 | tee -a "$LOG_FILE"
    else
        echo -e "${RED}[✗]${NC} 无法自动安装 Wine"
        echo "请手动安装 Wine 后重试"
    fi
    
    # 重新检查
    if command -v wine64 &> /dev/null; then
        echo -e "${GREEN}[✓]${NC} Wine 安装成功"
        cd "$BUILD_DIR/desktop-electron"
        npm run build:win 2>&1 | tee -a "$LOG_FILE"
    fi
fi

echo ""

# ============ iOS 构建 ============
echo -e "${YELLOW}=== iOS IPA 构建 ===${NC}"

if command -v xcodebuild &> /dev/null; then
    echo -e "${GREEN}[✓]${NC} 检测到 Xcode"
    cd "$BUILD_DIR/ios"
    
    echo "检查 xcodegen..."
    if command -v xcodegen &> /dev/null; then
        echo -e "${GREEN}[✓]${NC} xcodegen 已安装"
    else
        echo -e "${YELLOW}[i]${NC} xcodegen 未安装，尝试安装..."
        if command -v brew &> /dev/null; then
            brew install xcodegen
        else
            echo -e "${RED}[✗]${NC} 无法安装 xcodegen (需要 Homebrew)"
        fi
    fi
    
    if command -v xcodegen &> /dev/null; then
        echo "生成 Xcode 工程..."
        xcodegen generate 2>&1 | tee -a "$LOG_FILE"
        
        echo "构建 Release 版本..."
        xcodebuild -scheme Vxin -configuration Release \
            -archivePath build/Vxin.xcarchive archive 2>&1 | tee -a "$LOG_FILE"
        
        echo "导出 IPA..."
        xcodebuild -exportArchive \
            -archivePath build/Vxin.xcarchive \
            -exportOptionsPlist export-options.plist \
            -exportPath build/ 2>&1 | tee -a "$LOG_FILE"
        
        if [ -f "build/Vxin.ipa" ]; then
            echo -e "${GREEN}[✓]${NC} iOS IPA 构建成功"
            ls -lh build/Vxin.ipa
        fi
    fi
else
    echo -e "${RED}[✗]${NC} 需要 macOS + Xcode 环境"
    echo "当前系统: $(uname -s)"
    echo ""
    echo "iOS 构建需要在 macOS 上执行:"
    echo "  cd $BUILD_DIR/ios"
    echo "  xcodegen generate"
    echo "  xcodebuild -scheme Vxin -configuration Release -archivePath build/Vxin.xcarchive archive"
    echo "  xcodebuild -exportArchive -archivePath build/Vxin.xcarchive -exportOptionsPlist export-options.plist -exportPath build/"
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         构建完成                           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""
echo "日志文件: $LOG_FILE"

