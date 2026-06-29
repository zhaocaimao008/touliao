#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-appium.sh  —  一键初始化 Appium 移动端测试环境
#
# 支持: macOS(含 iOS 链路) / Linux(仅 Android)
# 用法: bash e2e/scripts/setup-appium.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${YEL}── $* ──${NC}"; }

OS="$(uname -s)"
E2E_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/.." && pwd)"

# ── 1. Java 17+ ───────────────────────────────────────────────────────────────
step "检查 Java"
if ! command -v java &>/dev/null; then
  die "未找到 java。请安装 JDK 17+:\n  macOS: brew install openjdk@17\n  Linux: apt install openjdk-17-jdk"
fi
JAVA_VER=$(java -version 2>&1 | awk -F'"' '/version/ {print $2}' | cut -d. -f1)
[[ "$JAVA_VER" -ge 17 ]] || die "Java 版本 $JAVA_VER < 17,请升级"
ok "Java $JAVA_VER"

# ── 2. Node 20+ ───────────────────────────────────────────────────────────────
step "检查 Node"
if ! command -v node &>/dev/null; then
  die "未找到 node。请安装 Node 20+:\n  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
fi
NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
[[ "$NODE_VER" -ge 20 ]] || die "Node 版本 $NODE_VER < 20"
ok "Node $NODE_VER"

# ── 3. Android SDK / adb ──────────────────────────────────────────────────────
step "检查 Android SDK"
if [[ -z "${ANDROID_HOME:-}" ]]; then
  # 常见默认路径探测
  for candidate in \
      "$HOME/Android/Sdk" \
      "$HOME/Library/Android/sdk" \
      "/opt/android-sdk"; do
    if [[ -d "$candidate/platform-tools" ]]; then
      export ANDROID_HOME="$candidate"
      break
    fi
  done
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  warn "未设置 ANDROID_HOME。"
  warn "请安装 Android Studio 并在 ~/.bashrc 中加入:"
  warn "  export ANDROID_HOME=\$HOME/Android/Sdk"
  warn "  export PATH=\$PATH:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/emulator"
  warn "或使用 sdkmanager 命令行安装 SDK。跳过 adb 检查继续..."
else
  export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
  if command -v adb &>/dev/null; then
    ok "adb $(adb version | head -1)"
  else
    warn "ANDROID_HOME=$ANDROID_HOME 但找不到 adb,请检查 platform-tools 是否已安装"
  fi
fi

# ── 4. Appium + 驱动 ──────────────────────────────────────────────────────────
step "安装/更新 Appium"
if command -v appium &>/dev/null; then
  ok "Appium $(appium --version)"
else
  npm install -g appium
  ok "Appium 安装完成"
fi

step "安装 UiAutomator2 驱动(Android)"
if appium driver list --installed 2>/dev/null | grep -q uiautomator2; then
  ok "UiAutomator2 已安装"
else
  appium driver install uiautomator2
  ok "UiAutomator2 安装完成"
fi

if [[ "$OS" == "Darwin" ]]; then
  step "安装 XCUITest 驱动(iOS / macOS only)"
  if appium driver list --installed 2>/dev/null | grep -q xcuitest; then
    ok "XCUITest 已安装"
  else
    appium driver install xcuitest
    ok "XCUITest 安装完成"
  fi

  step "检查 Xcode / xcrun(iOS)"
  if command -v xcrun &>/dev/null; then
    ok "Xcode $(xcrun --version 2>/dev/null || echo 'installed')"
  else
    warn "未找到 xcrun,iOS 测试需要安装 Xcode:\n  App Store → Xcode"
  fi
fi

# ── 5. Python 依赖 ─────────────────────────────────────────────────────────────
step "安装 Python 依赖"
if ! command -v pip3 &>/dev/null && ! command -v pip &>/dev/null; then
  die "未找到 pip。请先安装 Python 3.9+:\n  apt install python3-pip  或  brew install python"
fi
PIP=$(command -v pip3 || command -v pip)
"$PIP" install -r "$E2E_DIR/requirements.txt" -q
ok "Python 依赖安装完成"

# ── 6. 重新生成 anchors.py ────────────────────────────────────────────────────
step "生成 appium/anchors.py"
node "$E2E_DIR/shared/gen-anchors-py.js"
ok "anchors.py 已更新"

# ── 7. 汇总 ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GRN}══════════════════════════════════════════════${NC}"
echo -e "${GRN} 环境就绪!下一步:${NC}"
echo ""
echo "  Android:"
echo "    bash e2e/scripts/run-android.sh --app <path/to/app-debug.apk>"
echo ""
if [[ "$OS" == "Darwin" ]]; then
  echo "  iOS:"
  echo "    bash e2e/scripts/run-ios.sh --app <path/to/Vxin.app>"
  echo ""
fi
echo "  常见问题: cat e2e/README.md (故障排查一节)"
echo -e "${GRN}══════════════════════════════════════════════${NC}"
