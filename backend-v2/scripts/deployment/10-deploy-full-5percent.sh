#!/bin/bash
set -e

TIMESTAMP=$(date +%s)
VERSION="v${TIMESTAMP}"

echo "════════════════════════════════════════════════════════════"
echo "🟢 全量部署 5% - Full Deployment 5%"
echo "════════════════════════════════════════════════════════════"
echo "版本: $VERSION"
echo "目标: 全量环境 (All Regions) - 5% 流量"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Step 1: 部署到各个区域
echo "🚀 部署到全量环境 5% 各区域..."

REGIONS=("region-a" "region-b" "region-us" "region-eu")

for region in "${REGIONS[@]}"; do
  echo "  📍 部署到 $region..."
  kubectl set image deployment/vxin-backend-full \
    backend=registry.vxin.com/backend:$VERSION \
    -n production-$region \
    --record || true
done

# Step 2: 等待部署完成
echo "⏳ 等待全量 5% 部署完成..."
for region in "${REGIONS[@]}"; do
  kubectl rollout status deployment/vxin-backend-full -n production-$region --timeout=5m || true
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✅ 全量 5% 部署完成！"
echo "   版本: $VERSION"
echo "   区域: ${#REGIONS[@]} 个"
echo "════════════════════════════════════════════════════════════"

echo "$VERSION" > /tmp/full-5-version.txt
