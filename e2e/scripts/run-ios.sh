#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-ios.sh  —  一键跑 iOS Appium 测试 (仅 macOS)
#
# 用法:
#   bash e2e/scripts/run-ios.sh [--app <.app>] [--device <name>] [--suite <glob>]
#
# 选项:
#   --app     <path>   .app 路径(默认自动找 ios/build/.../Vxin.app)
#   --device  <name>   模拟器名称(默认 iPhone 15)
#   --version <ver>    iOS 版本(默认 17.0)
#   --suite   <glob>   测试文件匹配(默认 test_*.py)
#   --edge-only        只跑 EDGE-A 边界用例
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${YEL}── $* ──${NC}"; }

[[ "$(uname -s)" == "Darwin" ]] || die "iOS 测试仅支持 macOS"

E2E_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/.." && pwd)"
IOS_DIR="$REPO_ROOT/ios"

APP_PATH=""
DEVICE="iPhone 15"
IOS_VERSION="17.0"
SUITE="test_*.py"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)       APP_PATH="$2";    shift 2 ;;
    --device)    DEVICE="$2";      shift 2 ;;
    --version)   IOS_VERSION="$2"; shift 2 ;;
    --suite)     SUITE="$2";       shift 2 ;;
    --edge-only) SUITE="test_edge.py"; shift ;;
    *) die "未知参数: $1" ;;
  esac
done

# ── 自动找 .app ───────────────────────────────────────────────────────────────
if [[ -z "$APP_PATH" ]]; then
  FOUND=$(find "$IOS_DIR/build" -name "Vxin.app" -type d 2>/dev/null | head -1 || true)
  if [[ -n "$FOUND" ]]; then
    APP_PATH="$FOUND"
    ok "自动找到 .app: $APP_PATH"
  else
    warn "未指定 --app 且未找到 Vxin.app,尝试构建..."
    step "生成 Xcode 工程 + 构建"
    command -v xcodegen &>/dev/null || die "未找到 xcodegen。请: brew install xcodegen"
    (
      cd "$IOS_DIR"
      xcodegen generate
      xcodebuild -project Vxin.xcodeproj \
        -scheme Vxin \
        -sdk iphonesimulator \
        -configuration Debug \
        -derivedDataPath build \
        -quiet \
        IPHONEOS_DEPLOYMENT_TARGET=16.0
    )
    APP_PATH=$(find "$IOS_DIR/build" -name "Vxin.app" -type d | head -1)
    [[ -n "$APP_PATH" ]] || die "构建后仍未找到 Vxin.app"
    ok ".app: $APP_PATH"
  fi
fi

# ── 检查 Xcode / xcrun ────────────────────────────────────────────────────────
step "检查 Xcode 工具链"
command -v xcrun &>/dev/null || die "未找到 xcrun,请安装 Xcode 并运行: xcode-select --install"
ok "xcrun $(xcrun --version 2>/dev/null | head -1)"

# ── 启动 iOS 模拟器 ───────────────────────────────────────────────────────────
step "启动 iOS 模拟器 ($DEVICE)"
# 找到匹配设备的 UDID
UDID=$(xcrun simctl list devices available | \
       grep -i "$DEVICE" | head -1 | \
       grep -oE '[0-9A-F-]{36}' | head -1 || true)
if [[ -z "$UDID" ]]; then
  warn "模拟器 '$DEVICE' 不存在,可用设备列表:"
  xcrun simctl list devices available | grep -i iphone | head -10
  die "请指定正确的 --device 名称"
fi

STATE=$(xcrun simctl list devices | grep "$UDID" | grep -o 'Booted\|Shutdown' || true)
if [[ "$STATE" == "Booted" ]]; then
  ok "模拟器 $DEVICE ($UDID) 已运行"
else
  xcrun simctl boot "$UDID"
  open -a Simulator
  echo -n "等待模拟器启动"
  until xcrun simctl list devices | grep "$UDID" | grep -q Booted; do
    echo -n "."; sleep 2
  done
  echo ""
  ok "模拟器已就绪"
fi

# iOS 模拟器与宿主共享网络栈,直接 127.0.0.1:3099
warn "iOS 模拟器内测试后端地址: http://127.0.0.1:3099"
warn "请在 App 登录页 → 切换服务器 → 填入该地址"

# ── 启动 Appium Server ────────────────────────────────────────────────────────
step "启动 Appium Server"
if lsof -ti tcp:4723 &>/dev/null; then
  ok "Appium 已在 :4723 运行"
else
  command -v appium &>/dev/null || die "未找到 appium。请先运行: bash e2e/scripts/setup-appium.sh"
  nohup appium > /tmp/vxin-appium.log 2>&1 &
  echo "Appium PID=$!,日志: /tmp/vxin-appium.log"
  sleep 4
  lsof -ti tcp:4723 &>/dev/null || die "Appium 启动失败,查看 /tmp/vxin-appium.log"
  ok "Appium 已就绪 :4723"
fi

# ── 生成最新 anchors.py ───────────────────────────────────────────────────────
node "$E2E_DIR/shared/gen-anchors-py.js"
ok "anchors.py 已同步"

# ── 跑测试 ────────────────────────────────────────────────────────────────────
step "运行 Appium 测试 ($SUITE)"
cd "$E2E_DIR/appium"
set +e
IOS_DEVICE="$DEVICE" IOS_VERSION="$IOS_VERSION" \
pytest $SUITE \
  --platform=ios \
  --app="$APP_PATH" \
  -v \
  --tb=short \
  --no-header \
  2>&1 | tee /tmp/vxin-ios-test.log
EXIT_CODE=$?
set -e

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  echo -e "${GRN}══ iOS 测试全部通过 ══${NC}"
else
  echo -e "${RED}══ 有用例失败,查看日志 /tmp/vxin-ios-test.log ══${NC}"
  echo ""
  echo "常见原因:"
  echo "  1. 元素找不到 → 确认 .accessibilityIdentifier 已设(需重编译)"
  echo "  2. 权限弹窗 → XCUITest capabilities autoAcceptAlerts=true 应处理"
  echo "  3. WDA 编译失败 → xcodebuild -scheme WebDriverAgentRunner test (手动验证)"
  echo "  4. App 连不上后端 → 确认后端在 3099,App 内填 http://127.0.0.1:3099"
  echo "  5. UDID 漂移 → xcrun simctl list devices 查最新 UDID,重传 --device"
fi
exit $EXIT_CODE
