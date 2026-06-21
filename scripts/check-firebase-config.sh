#!/usr/bin/env bash
# 检查 Firebase 推送配置是否就绪（占位 vs 真实）。只读，不修改任何文件。
# 用法: bash scripts/check-firebase-config.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ok=0; bad=0
pass() { echo "  ✅ $1"; ok=$((ok+1)); }
fail() { echo "  ❌ $1"; bad=$((bad+1)); }

echo "== Android: android/app/google-services.json =="
F="$ROOT/android/app/google-services.json"
if [ ! -f "$F" ]; then fail "文件不存在"
elif grep -qE "vxin-placeholder|PLACEHOLDER|\"000000000000\"" "$F"; then fail "仍是占位文件，需替换为 Firebase 控制台下载的真实文件"
else pass "已是真实配置"; fi

echo "== iOS: ios/Vxin/GoogleService-Info.plist =="
F="$ROOT/ios/Vxin/GoogleService-Info.plist"
if [ ! -f "$F" ]; then fail "文件不存在"
elif grep -qE "vxin-placeholder|PLACEHOLDER|000000000000" "$F"; then fail "仍是占位文件，需替换为真实 GoogleService-Info.plist"
else pass "已是真实配置"; fi

echo "== Backend: backend-v2/.env Firebase 变量 =="
E="$ROOT/backend-v2/.env"
if [ ! -f "$E" ]; then fail "backend-v2/.env 不存在"
else
  for k in FIREBASE_PROJECT_ID FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY; do
    v=$(grep -E "^$k=" "$E" | head -1 | cut -d= -f2-)
    if [ -z "$v" ]; then fail "$k 未设置（运行 setup-firebase-admin.js 自动写入）"; else pass "$k 已设置"; fi
  done
fi

echo "== App 默认服务器地址（占位检查）=="
grep -q "api.91aigu.com\|api.example.com" "$ROOT/android/app/build.gradle.kts" 2>/dev/null && echo "  ⚠️  Android DEFAULT_SERVER_URL 仍是占位，确认指向生产后端" || echo "  ✅ Android 服务器地址已自定义"
grep -q "api.91aigu.com\|api.example.com" "$ROOT/ios/Vxin/Core/Storage/ServerConfig.swift" 2>/dev/null && echo "  ⚠️  iOS defaultURL 仍是占位，确认指向生产后端" || echo "  ✅ iOS 服务器地址已自定义"

echo
echo "结果: $ok 项就绪, $bad 项待处理"
[ "$bad" -eq 0 ] && echo "🎉 Firebase 推送配置已就绪" || echo "👉 按 FIREBASE_SETUP.md 处理 ❌ 项"
