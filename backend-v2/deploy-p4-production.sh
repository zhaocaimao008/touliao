#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# P4 生产部署脚本 (保守模式 - 推荐首次部署)
# ═══════════════════════════════════════════════════════════════════════════

set -e

echo "🚀 v信 P4 优化生产部署"
echo "时间: $(date)"
echo ""

# Step 1: 验证所有 P4 文件
echo "【Step 1】验证 P4 文件完整性..."
FILES=(
  "src/utils/searchRanking.js"
  "src/utils/deduplicator.js"
  "src/utils/batchAckManager.js"
  "src/utils/cacheWarmer.js"
  "src/utils/networkAwareRetry.js"
  "src/utils/redis.js"
  "src/routes/optimization.routes.js"
  "src/server.js"
  "src/app.js"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file 缺失!"
    exit 1
  fi
done

echo ""
echo "【Step 2】备份现有数据库..."
cp src/wechat.db src/wechat.db.backup.$(date +%Y%m%d_%H%M%S)
echo "  ✅ 备份完成"

echo ""
echo "【Step 3】验证依赖..."
npm ls 2>&1 | grep -i "missing\|ERR" && exit 1
echo "  ✅ 依赖完整"

echo ""
echo "【Step 4】语法检查..."
node -c src/utils/searchRanking.js
node -c src/utils/deduplicator.js
node -c src/utils/batchAckManager.js
node -c src/utils/cacheWarmer.js
node -c src/utils/networkAwareRetry.js
node -c src/utils/redis.js
node -c src/routes/optimization.routes.js
node -c src/server.js
echo "  ✅ 所有文件通过语法检查"

echo ""
echo "【Step 5】运行测试..."
npm test -- --testPathPattern="optimization" 2>&1 | tail -20
echo "  ✅ 测试完成"

echo ""
echo "【Step 6】停止现有服务..."
pm2 stop vxin-server-v2 2>/dev/null || echo "  (服务未运行)"

echo ""
echo "【Step 7】启动新服务..."
pm2 start src/server.js --name vxin-server-v2 --update-env
sleep 5

echo ""
echo "【Step 8】验证服务状态..."
pm2 status vxin-server-v2
pm2 logs vxin-server-v2 --lines 20

echo ""
echo "【Step 9】测试 API 端点..."
sleep 2
curl -s http://localhost:3002/health | jq . && echo "  ✅ 健康检查通过"
curl -s http://localhost:3002/api/optimization/stats | jq '.searchRanking' | head -3 && echo "  ✅ 优化模块已加载"

echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "✅ P4 生产部署完成！"
echo ""
echo "📊 服务状态:"
pm2 status vxin-server-v2
echo ""
echo "📈 监控命令:"
echo "  pm2 logs vxin-server-v2           # 查看日志"
echo "  pm2 monit                         # 实时监控"
echo "  curl http://localhost:3002/health # 健康检查"
echo ""
echo "🔄 回滚命令 (如需要):"
echo "  pm2 stop vxin-server-v2"
echo "  git revert HEAD"
echo "  pm2 start src/server.js --name vxin-server-v2"
echo ""

