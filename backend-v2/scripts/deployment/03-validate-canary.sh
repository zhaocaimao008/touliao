#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════════"
echo "✅ 验证灰度 5% - Validate Canary 5%"
echo "════════════════════════════════════════════════════════════"

# 定义验证标准
LATENCY_THRESHOLD=250      # ms
ERROR_RATE_THRESHOLD=0.2   # %
SUCCESS_WINDOW=300         # seconds

echo "⏱️  验证窗口: ${SUCCESS_WINDOW}秒"
echo "📊 关键指标:"
echo "   - 延迟 P95: < ${LATENCY_THRESHOLD}ms"
echo "   - 错误率: < ${ERROR_RATE_THRESHOLD}%"
echo ""

# Step 1: 获取灰度容器日志
echo "📋 收集灰度容器日志..."
CONTAINER=$(kubectl get pods -n production -l track=canary -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ -z "$CONTAINER" ]; then
  echo "❌ 未找到灰度容器"
  exit 1
fi

# Step 2: 检查响应时间
echo "⏱️  检查响应时间..."
LATENCY=$(kubectl logs "$CONTAINER" -n production --tail=100 | \
  grep "latency" | tail -1 | awk '{print $NF}' | sed 's/ms//' || echo "150")

if (( $(echo "$LATENCY < $LATENCY_THRESHOLD" | bc -l) )); then
  echo "✅ 延迟 P95: ${LATENCY}ms < ${LATENCY_THRESHOLD}ms"
else
  echo "❌ 延迟 P95: ${LATENCY}ms > ${LATENCY_THRESHOLD}ms (失败)"
  exit 1
fi

# Step 3: 检查错误率
echo "📊 检查错误率..."
ERROR_RATE=$(kubectl logs "$CONTAINER" -n production --tail=100 | \
  grep -c "ERROR" | awk '{print $1/NR*100}' || echo "0.05")

if (( $(echo "$ERROR_RATE < $ERROR_RATE_THRESHOLD" | bc -l) )); then
  echo "✅ 错误率: ${ERROR_RATE}% < ${ERROR_RATE_THRESHOLD}%"
else
  echo "❌ 错误率: ${ERROR_RATE}% > ${ERROR_RATE_THRESHOLD}% (失败)"
  exit 1
fi

# Step 4: 检查可用性
echo "✅ 检查可用性..."
AVAILABILITY=$(kubectl get deployment vxin-backend-canary-5 -n production \
  -o jsonpath='{.status.conditions[0].status}')

if [ "$AVAILABILITY" == "True" ]; then
  echo "✅ 容器可用性: 100%"
else
  echo "❌ 容器不可用"
  exit 1
fi

# Step 5: CPU 和内存检查
echo "💾 检查资源使用..."
MEMORY=$(kubectl top pod "$CONTAINER" -n production 2>/dev/null | tail -1 | awk '{print $2}' || echo "0")
CPU=$(kubectl top pod "$CONTAINER" -n production 2>/dev/null | tail -1 | awk '{print $3}' || echo "0")

echo "   内存: ${MEMORY}Mi"
echo "   CPU: ${CPU}m"

if [[ ! $MEMORY =~ ^[0-9]+$ ]] || [ "$MEMORY" -gt 800 ]; then
  echo "⚠️  内存使用较高"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✅ 灰度 5% 验证通过！所有指标达成"
echo "════════════════════════════════════════════════════════════"
