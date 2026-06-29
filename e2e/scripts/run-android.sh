#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-android.sh  —  一键跑 Android Appium 测试
#
# 用法:
#   bash e2e/scripts/run-android.sh [--app <apk>] [--avd <name>] [--real] [--suite <glob>]
#
# 选项:
#   --app  <path>   APK 路径(默认自动找 android/.../app-debug.apk)
#   --avd  <name>   AVD 名称(默认 vxin-test);不传 --real 时启动模拟器
#   --real          使用已连接真机(不启动模拟器)
#   --suite <glob>  只跑匹配的测试文件(默认 test_*.py)
#   --edge-only     只跑 EDGE-A 边界用例(test_edge.py)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${YEL}── $* ──${NC}"; }

E2E_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"

APK=""
AVD="vxin-test"
USE_REAL=false
SUITE="test_*.py"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)     APK="$2";   shift 2 ;;
    --avd)     AVD="$2";   shift 2 ;;
    --real)    USE_REAL=true; shift ;;
    --suite)   SUITE="$2"; shift 2 ;;
    --edge-only) SUITE="test_edge.py"; shift ;;
    *) die "未知参数: $1" ;;
  esac
done

# ── 自动找 APK ────────────────────────────────────────────────────────────────
if [[ -z "$APK" ]]; then
  FOUND=$(find "$ANDROID_DIR" -name "app-debug.apk" 2>/dev/null | head -1 || true)
  if [[ -n "$FOUND" ]]; then
    APK="$FOUND"
    ok "自动找到 APK: $APK"
  else
    warn "未指定 --app 且未找到 app-debug.apk,将尝试先构建"
    step "构建 Debug APK"
    (cd "$ANDROID_DIR" && ./gradlew assembleDebug --quiet)
    APK=$(find "$ANDROID_DIR" -name "app-debug.apk" | head -1)
    [[ -n "$APK" ]] || die "构建后仍未找到 APK"
    ok "APK: $APK"
  fi
fi

# ── 设置 ANDROID_HOME / PATH ──────────────────────────────────────────────────
step "检查 adb"
for candidate in "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" "/opt/android-sdk"; do
  [[ -z "${ANDROID_HOME:-}" && -d "$candidate/platform-tools" ]] && export ANDROID_HOME="$candidate"
done
[[ -n "${ANDROID_HOME:-}" ]] && export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
command -v adb &>/dev/null || die "找不到 adb。请先运行 bash e2e/scripts/setup-appium.sh"

# ── 启动模拟器 or 检查真机 ────────────────────────────────────────────────────
if $USE_REAL; then
  step "检查真机"
  DEVICES=$(adb devices | awk 'NR>1 && /device$/ {print $1}')
  [[ -n "$DEVICES" ]] || die "未检测到已连接真机。请打开 USB 调试并连接后重试"
  ok "真机: $(echo "$DEVICES" | head -1)"
  DEVICE_SERIAL=$(echo "$DEVICES" | head -1)

  # adb reverse: 让真机通过 localhost:3099 访问宿主测试后端
  step "配置 adb reverse"
  adb -s "$DEVICE_SERIAL" reverse tcp:3099 tcp:3099
  ok "adb reverse tcp:3099 tcp:3099 完成(App 填 http://127.0.0.1:3099)"
else
  step "启动 Android 模拟器 ($AVD)"
  if ! avdmanager list avd 2>/dev/null | grep -q "Name: $AVD"; then
    warn "AVD '$AVD' 不存在,正在创建(系统镜像: android-34 x86_64)..."
    if ! command -v sdkmanager &>/dev/null; then
      die "未找到 sdkmanager。请在 Android Studio SDK Manager 里安装 API 34 镜像:\n  System Images > Android 14 > Google APIs > x86_64"
    fi
    sdkmanager --install "system-images;android-34;google_apis;x86_64" --quiet
    echo no | avdmanager create avd -n "$AVD" \
      -k "system-images;android-34;google_apis;x86_64" \
      --device "pixel_6"
    ok "AVD '$AVD' 创建完成"
  fi

  # 检查是否已有 running 模拟器
  RUNNING=$(adb devices | awk '/emulator/ && /device$/ {print $1}' | head -1)
  if [[ -n "$RUNNING" ]]; then
    ok "检测到已运行的模拟器: $RUNNING,直接使用"
  else
    ok "启动模拟器 $AVD(首次冷启动约 60-120s)..."
    nohup emulator -avd "$AVD" -no-snapshot -no-audio -gpu swiftshader_indirect \
      > /tmp/vxin-emulator.log 2>&1 &
    EMU_PID=$!
    echo "模拟器 PID=$EMU_PID,日志: /tmp/vxin-emulator.log"

    # 等待 online
    echo -n "等待设备上线"
    timeout 120 bash -c '
      until adb wait-for-device shell getprop sys.boot_completed 2>/dev/null | grep -q "1"; do
        echo -n "."; sleep 3
      done
    '
    echo ""
    ok "模拟器已就绪"
  fi

  # 模拟器访问宿主用 10.0.2.2,不需要 adb reverse
  warn "模拟器内测试后端地址: http://10.0.2.2:3099"
  warn "请在 App 登录页 → 切换服务器 → 填入该地址(或 conftest 自动设置)"
fi

# ── 安装 APK ──────────────────────────────────────────────────────────────────
step "安装 APK"
adb install -r "$APK"
ok "APK 安装完成"

# ── 启动 Appium Server ────────────────────────────────────────────────────────
step "启动 Appium Server"
if lsof -ti tcp:4723 &>/dev/null; then
  ok "Appium 已在 :4723 运行"
else
  command -v appium &>/dev/null || die "未找到 appium。请先运行 bash e2e/scripts/setup-appium.sh"
  nohup appium > /tmp/vxin-appium.log 2>&1 &
  echo "Appium PID=$!,日志: /tmp/vxin-appium.log"
  sleep 3
  lsof -ti tcp:4723 &>/dev/null || die "Appium 启动失败,查看 /tmp/vxin-appium.log"
  ok "Appium 已就绪 :4723"
fi

# ── 生成最新 anchors.py ───────────────────────────────────────────────────────
node "$E2E_DIR/shared/gen-anchors-py.js"
ok "anchors.py 已同步"

# ── 跑测试 ────────────────────────────────────────────────────────────────────
step "运行 Appium 测试 ($SUITE)"
cd "$E2E_DIR/appium"
set +e  # 允许测试失败退出码不中断脚本,最后汇报
pytest $SUITE \
  --platform=android \
  --app="$APK" \
  -v \
  --tb=short \
  --no-header \
  2>&1 | tee /tmp/vxin-android-test.log
EXIT_CODE=$?
set -e

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  echo -e "${GRN}══ Android 测试全部通过 ══${NC}"
else
  echo -e "${RED}══ 有用例失败,查看日志 /tmp/vxin-android-test.log ══${NC}"
  echo ""
  echo "常见原因:"
  echo "  1. 元素找不到 → 确认 APK 含最新锚点(assembleDebug 后重装)"
  echo "  2. App 连不上后端 → 模拟器填 10.0.2.2:3099,真机用 adb reverse"
  echo "  3. 权限弹窗未授 → conftest autoGrantPermissions=true 应自动处理"
  echo "  4. Appium session 超时 → 检查 /tmp/vxin-appium.log"
fi
exit $EXIT_CODE
