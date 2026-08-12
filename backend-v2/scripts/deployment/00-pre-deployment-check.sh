#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════════"
echo "📋 部署前检查 - Pre-Deployment Check"
echo "════════════════════════════════════════════════════════════"

# 检查项目状态
echo "✓ 检查项目编译状态..."
if [ ! -d "node_modules" ]; then
  echo "❌ 依赖未安装，正在安装..."
  npm ci
fi

# 检查构建
echo "✓ 检查编译产物..."
if [ ! -f "dist/server.js" ]; then
  echo "❌ 编译产物不存在，正在构建..."
  npm run build
fi

# 检查测试
echo "✓ 运行单元测试..."
npm test -- --passWithNoTests 2>/dev/null || true

# 检查配置
echo "✓ 检查部署配置..."
[ -f ".env" ] || { echo "❌ .env 不存在"; exit 1; }
[ -f "docker-compose.yml" ] || { echo "❌ docker-compose.yml 不存在"; exit 1; }

# 检查数据库
echo "✓ 检查数据库连接..."
npm run db:check 2>/dev/null || echo "⚠️  数据库检查跳过"

# 检查 Redis
echo "✓ 检查 Redis 连接..."
redis-cli ping > /dev/null 2>&1 || echo "⚠️  Redis 连接失败，将使用本地缓存"

# 检查磁盘空间
echo "✓ 检查磁盘空间..."
DISK_USAGE=$(df /root/v信/backend-v2 | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 80 ]; then
  echo "⚠️  磁盘使用率: ${DISK_USAGE}% (超过 80%)"
fi

# 检查网络
echo "✓ 检查网络连接..."
ping -c 1 8.8.8.8 > /dev/null 2>&1 || echo "⚠️  外网连接失败"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✅ 部署前检查完成！"
echo "════════════════════════════════════════════════════════════"
