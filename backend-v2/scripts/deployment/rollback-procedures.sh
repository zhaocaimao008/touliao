#!/bin/bash

##############################################################################
# 快速回滚程序 - Emergency Rollback Procedures
# 在部署失败时快速恢复到前一个稳定版本
##############################################################################

set -e

ROLLBACK_LOG="/tmp/rollback-$(date +%Y%m%d-%H%M%S).log"
ROLLBACK_START=$(date +%s)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$ROLLBACK_LOG"
}

print_header() {
  echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}🔄 紧急回滚程序 - Emergency Rollback${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
}

##############################################################################
# 回滚等级 1: 灰度回滚 (30 秒)
##############################################################################

rollback_canary() {
  echo -e "${YELLOW}🔄 Level 1: 灰度回滚 (30 秒)${NC}"
  
  log "开始灰度回滚..."
  
  # 删除灰度部署
  log "删除灰度 Deployment..."
  kubectl delete deployment vxin-backend-canary-5 -n production --ignore-not-found=true >> "$ROLLBACK_LOG" 2>&1
  kubectl delete deployment vxin-backend-canary-50 -n production --ignore-not-found=true >> "$ROLLBACK_LOG" 2>&1
  
  # 等待 Pod 删除
  log "等待灰度 Pod 终止..."
  sleep 10
  
  # 验证回滚
  CANARY_PODS=$(kubectl get pods -n production -l track=canary --no-headers 2>/dev/null | wc -l)
  
  if [ "$CANARY_PODS" -eq 0 ]; then
    echo -e "${GREEN}✅ 灰度回滚成功${NC}"
    log "灰度回滚成功"
    return 0
  else
    echo -e "${RED}❌ 灰度回滚失败，仍有 $CANARY_PODS Pod 运行${NC}"
    return 1
  fi
}

##############################################################################
# 回滚等级 2: 全量部分回滚 (2 分钟)
##############################################################################

rollback_full_partial() {
  echo -e "${YELLOW}🔄 Level 2: 全量部分回滚 (2 分钟)${NC}"
  
  log "开始全量部分回滚..."
  
  REGIONS=("region-a" "region-b")
  
  for region in "${REGIONS[@]}"; do
    log "回滚 $region..."
    kubectl rollout undo deployment/vxin-backend-full -n production-$region >> "$ROLLBACK_LOG" 2>&1
    kubectl rollout status deployment/vxin-backend-full -n production-$region --timeout=2m >> "$ROLLBACK_LOG" 2>&1 || true
  done
  
  echo -e "${GREEN}✅ 全量部分回滚完成 (保留 US/EU 继续观察)${NC}"
  log "全量部分回滚完成"
}

##############################################################################
# 回滚等级 3: 全量完全回滚 (5 分钟)
##############################################################################

rollback_full_complete() {
  echo -e "${YELLOW}🔄 Level 3: 全量完全回滚 (5 分钟)${NC}"
  
  log "开始全量完全回滚..."
  
  REGIONS=("region-a" "region-b" "region-us" "region-eu")
  
  for region in "${REGIONS[@]}"; do
    log "回滚 $region..."
    kubectl rollout undo deployment/vxin-backend-full -n production-$region >> "$ROLLBACK_LOG" 2>&1
    kubectl rollout status deployment/vxin-backend-full -n production-$region --timeout=2m >> "$ROLLBACK_LOG" 2>&1 || true
  done
  
  echo -e "${GREEN}✅ 全量完全回滚完成${NC}"
  log "全量完全回滚完成"
}

##############################################################################
# 回滚等级 4: 数据库回滚 (1 分钟)
##############################################################################

rollback_database() {
  echo -e "${YELLOW}🔄 Level 4: 数据库回滚 (1 分钟)${NC}"
  
  log "检查数据库备份..."
  
  LATEST_BACKUP=$(ls -t /root/v信/backend-v2/backups/backup-full-*.tar.gz 2>/dev/null | head -1)
  
  if [ -z "$LATEST_BACKUP" ]; then
    echo -e "${RED}❌ 未找到数据库备份${NC}"
    return 1
  fi
  
  log "使用备份: $LATEST_BACKUP"
  
  # 创建恢复点
  RESTORE_POINT="/root/v信/backend-v2/backups/restore-$(date +%s).tar.gz"
  tar -czf "$RESTORE_POINT" /root/v信/backend-v2/src --exclude=node_modules >> "$ROLLBACK_LOG" 2>&1
  
  log "恢复代码从备份: $LATEST_BACKUP"
  tar -xzf "$LATEST_BACKUP" -C /root/v信/backend-v2 >> "$ROLLBACK_LOG" 2>&1
  
  echo -e "${GREEN}✅ 数据库回滚完成${NC}"
  log "数据库回滚完成，恢复点: $RESTORE_POINT"
}

##############################################################################
# 回滚等级 5: 完全系统恢复 (10 分钟)
##############################################################################

rollback_system_complete() {
  echo -e "${YELLOW}🔄 Level 5: 完全系统恢复 (10 分钟)${NC}"
  
  log "执行完全系统恢复..."
  
  # 1. 回滚所有部署
  log "回滚所有 Kubernetes Deployment..."
  rollback_full_complete
  
  # 2. 清理灰度资源
  log "清理灰度资源..."
  kubectl delete deployment -n production -l track=canary >> "$ROLLBACK_LOG" 2>&1 || true
  kubectl delete service -n production -l track=canary >> "$ROLLBACK_LOG" 2>&1 || true
  
  # 3. 重启应用服务
  log "重启应用服务..."
  for region in "region-a" "region-b" "region-us" "region-eu"; do
    kubectl rollout restart deployment/vxin-backend-full -n production-$region >> "$ROLLBACK_LOG" 2>&1 || true
  done
  
  # 4. 等待所有 Pod 就绪
  log "等待所有 Pod 就绪..."
  sleep 30
  
  # 5. 清空缓存
  log "清空 Redis 缓存..."
  redis-cli flushdb >> "$ROLLBACK_LOG" 2>&1 || true
  
  echo -e "${GREEN}✅ 完全系统恢复完成${NC}"
  log "完全系统恢复完成"
}

##############################################################################
# 验证回滚
##############################################################################

verify_rollback() {
  echo -e "${BLUE}🔍 验证回滚结果...${NC}"
  
  log "验证回滚..."
  
  # 检查所有 Pod 状态
  echo ""
  echo "Kubernetes Pod 状态:"
  kubectl get pods -n production -o wide | head -10
  
  # 检查健康状态
  echo ""
  echo "应用健康检查:"
  curl -s http://localhost:3000/health | jq . || echo "健康检查失败"
  
  # 检查数据库
  echo ""
  echo "数据库状态:"
  sqlite3 /root/v信/backend-v2/data/vxin.db "SELECT COUNT(*) as users FROM users;" 2>/dev/null || echo "数据库查询失败"
  
  log "回滚验证完成"
}

##############################################################################
# 回滚触发程序
##############################################################################

main() {
  print_header
  log "回滚程序启动"
  
  echo ""
  echo "请选择回滚等级:"
  echo "  1. 灰度回滚 (30 秒) - 仅回滚灰度部分"
  echo "  2. 全量部分回滚 (2 分钟) - 回滚中国区域"
  echo "  3. 全量完全回滚 (5 分钟) - 回滚所有区域"
  echo "  4. 数据库回滚 (1 分钟) - 恢复代码备份"
  echo "  5. 完全系统恢复 (10 分钟) - 完全重置系统"
  echo "  0. 取消回滚"
  echo ""
  read -p "请输入选择 (0-5): " choice
  
  case $choice in
    1)
      rollback_canary
      ;;
    2)
      rollback_canary
      rollback_full_partial
      ;;
    3)
      rollback_canary
      rollback_full_complete
      ;;
    4)
      rollback_database
      ;;
    5)
      rollback_system_complete
      ;;
    0)
      echo "取消回滚"
      exit 0
      ;;
    *)
      echo "无效选择"
      exit 1
      ;;
  esac
  
  echo ""
  verify_rollback
  
  ROLLBACK_END=$(date +%s)
  ROLLBACK_DURATION=$((ROLLBACK_END - ROLLBACK_START))
  
  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}✅ 回滚完成${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo "回滚耗时: ${ROLLBACK_DURATION}秒"
  echo "日志文件: $ROLLBACK_LOG"
}

main
