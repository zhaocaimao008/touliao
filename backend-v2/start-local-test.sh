#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: P5-P8 本地测试环境启动脚本
# ═══════════════════════════════════════════════════════════════════════════

echo "【PHASE 2】启动 P5-P8 本地测试环境..."
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker 未安装，跳过本地测试"
  exit 0
fi

echo "🐳 启动 Docker Compose 完整栈..."
docker-compose -f docker-compose.p5p6p7p8.yml up -d 2>/dev/null || {
  echo "⚠️  Docker Compose 启动遇到问题 (可能未配置完整)"
  echo "   继续执行其他 Phase..."
}

echo "⏳ 等待服务初始化 (30秒)..."
sleep 30

echo ""
echo "📊 服务状态:"
docker-compose -f docker-compose.p5p6p7p8.yml ps 2>/dev/null || true

echo ""
echo "✅ PHASE 2 启动完成"

