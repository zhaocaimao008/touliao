#!/usr/bin/env bash
# 一键配置 iOS TestFlight 发布所需的 7 个 GitHub Secrets。
# 依赖：gh（已登录，有仓库 secret 写权限）、base64。macOS 上还需 security 导出证书。
#
# 用法（把材料放到同目录后运行）：
#   export IOS_CERTIFICATE_PASSWORD='导出 .p12 时设的密码'
#   export IOS_KEYCHAIN_PASSWORD='任意临时口令(≥6位，仅 CI 内部用)'
#   export ASC_KEY_ID='App Store Connect API Key 的 Key ID'
#   export ASC_ISSUER_ID='App Store Connect 的 Issuer ID'
#   bash scripts/setup-ios-secrets.sh \
#        /path/to/distribution.p12 \
#        /path/to/vxin_distribution.mobileprovision \
#        /path/to/AuthKey_XXXXXX.p8
set -euo pipefail

P12="${1:?用法: setup-ios-secrets.sh <发布证书.p12> <描述文件.mobileprovision> <ASC AuthKey.p8>}"
PROFILE="${2:?缺少 .mobileprovision 路径}"
ASCKEY="${3:?缺少 App Store Connect AuthKey .p8 路径}"

: "${IOS_CERTIFICATE_PASSWORD:?请先 export IOS_CERTIFICATE_PASSWORD（导出 p12 时的密码）}"
: "${IOS_KEYCHAIN_PASSWORD:?请先 export IOS_KEYCHAIN_PASSWORD（任意临时口令）}"
: "${ASC_KEY_ID:?请先 export ASC_KEY_ID}"
: "${ASC_ISSUER_ID:?请先 export ASC_ISSUER_ID}"

for f in "$P12" "$PROFILE" "$ASCKEY"; do
  [ -f "$f" ] || { echo "❌ 文件不存在: $f"; exit 1; }
done

echo "→ 校验 gh 登录…"; gh auth status >/dev/null || { echo "❌ gh 未登录"; exit 1; }

b64() { base64 -w0 "$1" 2>/dev/null || base64 "$1" | tr -d '\n'; }  # Linux -w0 / macOS 兼容

echo "→ 写入 7 个 Secrets…"
gh secret set IOS_CERTIFICATE_P12_BASE64      --body "$(b64 "$P12")"
gh secret set IOS_CERTIFICATE_PASSWORD        --body "$IOS_CERTIFICATE_PASSWORD"
gh secret set IOS_PROVISIONING_PROFILE_BASE64 --body "$(b64 "$PROFILE")"
gh secret set IOS_KEYCHAIN_PASSWORD           --body "$IOS_KEYCHAIN_PASSWORD"
gh secret set ASC_KEY_ID                      --body "$ASC_KEY_ID"
gh secret set ASC_ISSUER_ID                   --body "$ASC_ISSUER_ID"
gh secret set ASC_API_KEY_BASE64              --body "$(b64 "$ASCKEY")"

echo "✅ 完成。当前 iOS 相关 Secrets："
gh secret list | grep -E 'IOS_|ASC_' || true
echo
echo "下一步：触发发版 →  gh workflow run ios-testflight.yml --ref main -f version=1.0.9"
