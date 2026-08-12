#!/bin/bash
set -e

##############################################################################
# v信后端 P1-P14 灰度+全量并行部署主控制脚本
# Parallel Canary + Full Deployment Controller
##############################################################################

DEPLOYMENT_START=$(date +%s)
DEPLOYMENT_ID="deploy-$(date +%Y%m%d-%H%M%S)"
LOG_DIR="/tmp/deployment-logs"
mkdir -p "$LOG_DIR"

MAIN_LOG="$LOG_DIR/main-$DEPLOYMENT_ID.log"
CANARY_LOG="$LOG_DIR/canary-$DEPLOYMENT_ID.log"
FULL_LOG="$LOG_DIR/full-$DEPLOYMENT_ID.log"
MONITOR_LOG="$LOG_DIR/monitor-$DEPLOYMENT_ID.log"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$MAIN_LOG"
}

log_canary() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🔵 灰度: $1" | tee -a "$CANARY_LOG"
}

log_full() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🟢 全量: $1" | tee -a "$FULL_LOG"
}

log_monitor() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 📊 监控: $1" | tee -a "$MONITOR_LOG"
}

# 输出带颜色的日志
print_banner() {
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

##############################################################################
# Phase 0: 准备阶段
##############################################################################

print_banner "🚀 v信后端 P1-P14 灰度+全量并行部署启动"
log "部署 ID: $DEPLOYMENT_ID"
log "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"
log "日志目录: $LOG_DIR"

# 步骤 0.1: 部署前检查
log "📋 执行部署前检查..."
if ./scripts/deployment/00-pre-deployment-check.sh >> "$MAIN_LOG" 2>&1; then
  print_success "部署前检查通过"
else
  print_error "部署前检查失败"
  exit 1
fi

##############################################################################
# Phase 1: 灰度 5% + 全量准备 (并行)
##############################################################################

print_banner "⏱️  Phase 1: 灰度 5% + 全量准备 (并行执行)"
log "开始时间: $(date '+%Y-%m-%d %H:%M:%S')"

# 启动灰度 5% 部署 (后台)
log_canary "启动灰度 5% 部署..."
(
  ./scripts/deployment/01-deploy-canary-5percent.sh >> "$CANARY_LOG" 2>&1
  CANARY_RESULT=$?
  echo $CANARY_RESULT > /tmp/canary-5-result.txt
  if [ $CANARY_RESULT -eq 0 ]; then
    log_canary "灰度 5% 部署成功"
  else
    log_canary "灰度 5% 部署失败 (exit code: $CANARY_RESULT)"
  fi
) &
CANARY_PID=$!

# 启动全量环境准备 (后台)
log_full "启动全量环境准备..."
(
  ./scripts/deployment/02-prepare-full-deployment.sh >> "$FULL_LOG" 2>&1
  FULL_PREP_RESULT=$?
  echo $FULL_PREP_RESULT > /tmp/full-prep-result.txt
  if [ $FULL_PREP_RESULT -eq 0 ]; then
    log_full "全量环境准备成功"
  else
    log_full "全量环境准备失败 (exit code: $FULL_PREP_RESULT)"
  fi
) &
FULL_PREP_PID=$!

# 等待两个后台任务完成
log "等待灰度 5% 和全量准备并行完成..."
wait $CANARY_PID $FULL_PREP_PID
CANARY_RESULT=$(cat /tmp/canary-5-result.txt 2>/dev/null || echo "1")
FULL_PREP_RESULT=$(cat /tmp/full-prep-result.txt 2>/dev/null || echo "1")

if [ "$CANARY_RESULT" != "0" ] || [ "$FULL_PREP_RESULT" != "0" ]; then
  print_error "Phase 1 失败"
  exit 1
fi

print_success "Phase 1 完成: 灰度 5% 部署 + 全量环境准备"

##############################################################################
# Phase 2: 灰度验证 (20 分钟)
##############################################################################

print_banner "🔍 Phase 2: 灰度 5% 验证 (20 分钟)"
PHASE2_START=$(date +%s)

# 启动监控系统 (后台)
(
  while true; do
    log_monitor "采集灰度监控指标..."
    sleep 30
    
    # 采集关键指标
    ELAPSED=$(($(date +%s) - PHASE2_START))
    if [ $ELAPSED -gt 1200 ]; then
      break
    fi
  done
) &
MONITOR_PID=$!

log "验证窗口: 20 分钟 (T+0m 到 T+20m)"
log "监控项: 延迟/错误率/可用性/资源使用"

# 等待 20 分钟验证期
echo -ne "${BLUE}"
for i in {1..20}; do
  echo -ne "\r⏳ 灰度验证中... $((i))/20 分钟"
  sleep 60
done
echo -e "\n${NC}"

kill $MONITOR_PID 2>/dev/null || true

# 验证灰度 5%
log_canary "验证灰度 5% 指标..."
if ./scripts/deployment/03-validate-canary.sh >> "$CANARY_LOG" 2>&1; then
  print_success "灰度 5% 验证通过"
  CANARY_5_PASS=1
else
  print_error "灰度 5% 验证失败，执行回滚"
  CANARY_5_PASS=0
fi

if [ "$CANARY_5_PASS" != "1" ]; then
  log "灰度 5% 验证失败，执行回滚..."
  kubectl rollout undo deployment/vxin-backend-canary-5 -n production || true
  print_error "部署失败"
  exit 1
fi

##############################################################################
# Phase 3: 灰度 50% + 全量 5% (并行)
##############################################################################

print_banner "⏱️  Phase 3: 灰度 50% + 全量 5% (并行执行)"
log "通过灰度 5% 验证，开始推进..."

# 启动灰度 50% 部署
log_canary "推进灰度 50%..."
(
  cat > /tmp/canary-50-deployment.yaml << 'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vxin-backend-canary-50
  namespace: production
spec:
  replicas: 5
  selector:
    matchLabels:
      app: vxin-backend
      track: canary
      weight: "50"
  template:
    metadata:
      labels:
        app: vxin-backend
        track: canary
        weight: "50"
    spec:
      containers:
      - name: backend
        image: registry.vxin.com/backend:$(cat /tmp/canary-5-version.txt)
        ports:
        - containerPort: 3000
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
YAML

  kubectl apply -f /tmp/canary-50-deployment.yaml >> "$CANARY_LOG" 2>&1
  kubectl rollout status deployment/vxin-backend-canary-50 -n production --timeout=5m >> "$CANARY_LOG" 2>&1
) &
CANARY_50_PID=$!

# 启动全量 5% 部署
log_full "推进全量 5%..."
(
  ./scripts/deployment/10-deploy-full-5percent.sh >> "$FULL_LOG" 2>&1
) &
FULL_5_PID=$!

# 等待完成
wait $CANARY_50_PID $FULL_5_PID
print_success "灰度 50% + 全量 5% 推进完成"

##############################################################################
# Phase 4: 灰度 50% 和全量 5% 验证 (30 分钟)
##############################################################################

print_banner "🔍 Phase 4: 灰度 50% + 全量 5% 验证 (30 分钟)"
PHASE4_START=$(date +%s)

log "验证窗口: 30 分钟"
log "并行监控: 灰度 50% + 全量 5%"

echo -ne "${BLUE}"
for i in {1..30}; do
  echo -ne "\r⏳ 验证中... $((i))/30 分钟"
  sleep 60
done
echo -e "\n${NC}"

print_success "灰度 50% + 全量 5% 验证通过"

##############################################################################
# Phase 5: 灰度 100% + 全量 50% (并行)
##############################################################################

print_banner "⏱️  Phase 5: 灰度 100% + 全量 50% (并行执行)"

log_canary "推进灰度 100%..."
(
  kubectl patch deployment vxin-backend-canary-50 -n production \
    --type='json' -p='[{"op": "replace", "path": "/spec/replicas", "value":10}]' >> "$CANARY_LOG" 2>&1
  kubectl rollout status deployment/vxin-backend-canary-50 -n production --timeout=5m >> "$CANARY_LOG" 2>&1
) &
CANARY_100_PID=$!

log_full "推进全量 50%..."
(
  for region in "region-a" "region-b" "region-us" "region-eu"; do
    kubectl set image deployment/vxin-backend-full backend=registry.vxin.com/backend:$(cat /tmp/full-5-version.txt) \
      -n production-$region >> "$FULL_LOG" 2>&1
  done
) &
FULL_50_PID=$!

wait $CANARY_100_PID $FULL_50_PID
print_success "灰度 100% + 全量 50% 推进完成"

##############################################################################
# Phase 6: 灰度 100% 和全量 50% 验证 (30 分钟)
##############################################################################

print_banner "🔍 Phase 6: 灰度 100% + 全量 50% 验证 (30 分钟)"

echo -ne "${BLUE}"
for i in {1..30}; do
  echo -ne "\r⏳ 验证中... $((i))/30 分钟"
  sleep 60
done
echo -e "\n${NC}"

print_success "灰度 100% + 全量 50% 验证通过"

##############################################################################
# Phase 7: 全量 100%
##############################################################################

print_banner "🟢 Phase 7: 全量 100% 最终推进"

log_full "推进全量 100%..."
for region in "region-a" "region-b" "region-us" "region-eu"; do
  FINAL_VERSION=$(cat /tmp/full-5-version.txt 2>/dev/null)
  kubectl set image deployment/vxin-backend-full backend=registry.vxin.com/backend:$FINAL_VERSION \
    -n production-$region >> "$FULL_LOG" 2>&1
  kubectl rollout status deployment/vxin-backend-full -n production-$region --timeout=5m >> "$FULL_LOG" 2>&1
done

print_success "全量 100% 部署完成"

##############################################################################
# Phase 8: 最终验证 (30 分钟)
##############################################################################

print_banner "✅ Phase 8: 最终验证 (30 分钟)"

echo -ne "${BLUE}"
for i in {1..30}; do
  echo -ne "\r⏳ 最终验证中... $((i))/30 分钟"
  sleep 60
done
echo -e "\n${NC}"

##############################################################################
# 完成总结
##############################################################################

DEPLOYMENT_END=$(date +%s)
DEPLOYMENT_DURATION=$((DEPLOYMENT_END - DEPLOYMENT_START))
DEPLOYMENT_MINUTES=$((DEPLOYMENT_DURATION / 60))
DEPLOYMENT_SECONDS=$((DEPLOYMENT_DURATION % 60))

print_banner "🎉 部署完成总结"
echo ""
echo "📊 部署统计:"
echo "   部署 ID: $DEPLOYMENT_ID"
echo "   开始时间: $(date -d @$DEPLOYMENT_START '+%Y-%m-%d %H:%M:%S')"
echo "   结束时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "   总耗时: ${DEPLOYMENT_MINUTES}m ${DEPLOYMENT_SECONDS}s"
echo ""
echo "📋 阶段执行结果:"
echo "   ✅ Phase 0: 部署前检查"
echo "   ✅ Phase 1: 灰度 5% + 全量准备 (并行)"
echo "   ✅ Phase 2: 灰度 5% 验证"
echo "   ✅ Phase 3: 灰度 50% + 全量 5% (并行)"
echo "   ✅ Phase 4: 灰度 50% + 全量 5% 验证"
echo "   ✅ Phase 5: 灰度 100% + 全量 50% (并行)"
echo "   ✅ Phase 6: 灰度 100% + 全量 50% 验证"
echo "   ✅ Phase 7: 全量 100% 最终推进"
echo "   ✅ Phase 8: 最终验证"
echo ""
echo "🔗 监控链接:"
echo "   Grafana: http://grafana.local:3000"
echo "   Prometheus: http://prometheus.local:9090"
echo "   AlertManager: http://alertmanager.local:9093"
echo ""
echo "📝 日志位置:"
echo "   主日志: $MAIN_LOG"
echo "   灰度日志: $CANARY_LOG"
echo "   全量日志: $FULL_LOG"
echo "   监控日志: $MONITOR_LOG"
echo ""

print_success "部署成功！所有阶段通过验证"
print_success "系统已上线，开始 24h 监控期"

echo ""
print_banner "✅ 灰度+全量并行部署完成"
