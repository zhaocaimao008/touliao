#!/bin/bash

##############################################################################
# 实时监控系统 - Real-time Deployment Monitor
# 用于灰度+全量并行部署的实时指标收集和告警
##############################################################################

MONITOR_LOG="/tmp/deployment-monitor-$(date +%s).log"
METRICS_JSON="/tmp/deployment-metrics-$(date +%Y%m%d-%H%M%S).json"

# 告警阈值
LATENCY_CRITICAL=500      # ms
LATENCY_WARNING=300       # ms
ERROR_RATE_CRITICAL=1.0   # %
ERROR_RATE_WARNING=0.5    # %
CPU_CRITICAL=85           # %
CPU_WARNING=75            # %
MEMORY_CRITICAL=90        # %
MEMORY_WARNING=80         # %

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
  clear
  echo -e "${CYAN}"
  echo "╔════════════════════════════════════════════════════════════════════════════╗"
  echo "║                    🎯 v信后端部署实时监控系统                              ║"
  echo "║                   Parallel Canary + Full Deployment Monitor                ║"
  echo "╚════════════════════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo "监控时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""
}

monitor_canary() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🔵 灰度环境监控 (Canary Environment)${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  # 获取灰度 Pod 信息
  CANARY_PODS=$(kubectl get pods -n production -l track=canary -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
  
  if [ -z "$CANARY_PODS" ]; then
    echo "⚠️  未找到灰度 Pod"
    return 1
  fi
  
  CANARY_COUNT=$(echo $CANARY_PODS | wc -w)
  echo "运行 Pod 数: $CANARY_COUNT"
  
  # 收集指标
  local total_latency=0
  local total_errors=0
  local total_requests=0
  
  for pod in $CANARY_PODS; do
    # 获取最近日志
    POD_LOGS=$(kubectl logs "$pod" -n production --tail=50 2>/dev/null)
    
    # 提取延迟 (假设日志格式包含 latency=xxx)
    POD_LATENCY=$(echo "$POD_LOGS" | grep -oP 'latency=\K[0-9]+' | tail -1 || echo "0")
    
    # 提取错误数
    POD_ERRORS=$(echo "$POD_LOGS" | grep -c "ERROR" || echo "0")
    
    # 提取请求数
    POD_REQUESTS=$(echo "$POD_LOGS" | grep -c "request" || echo "1")
    
    echo "  Pod: $pod | 延迟: ${POD_LATENCY}ms | 错误: $POD_ERRORS | 请求: $POD_REQUESTS"
    
    total_latency=$((total_latency + POD_LATENCY))
    total_errors=$((total_errors + POD_ERRORS))
    total_requests=$((total_requests + POD_REQUESTS))
  done
  
  # 计算平均值
  AVG_LATENCY=$((total_latency / CANARY_COUNT))
  ERROR_RATE=$(echo "scale=2; ($total_errors / $total_requests) * 100" | bc -l 2>/dev/null || echo "0")
  
  echo ""
  echo "  平均延迟: ${AVG_LATENCY}ms"
  echo "  错误率: ${ERROR_RATE}%"
  
  # 告警判断
  if (( $(echo "$AVG_LATENCY > $LATENCY_CRITICAL" | bc -l) )); then
    echo -e "  ${RED}🔴 严重告警: 延迟超过阈值 ($AVG_LATENCY > $LATENCY_CRITICAL ms)${NC}"
    return 1
  elif (( $(echo "$AVG_LATENCY > $LATENCY_WARNING" | bc -l) )); then
    echo -e "  ${YELLOW}🟡 警告: 延迟接近阈值 ($AVG_LATENCY > $LATENCY_WARNING ms)${NC}"
  else
    echo -e "  ${GREEN}✅ 延迟正常${NC}"
  fi
  
  if (( $(echo "$ERROR_RATE > $ERROR_RATE_CRITICAL" | bc -l) )); then
    echo -e "  ${RED}🔴 严重告警: 错误率超过阈值 ($ERROR_RATE > $ERROR_RATE_CRITICAL %)${NC}"
    return 1
  elif (( $(echo "$ERROR_RATE > $ERROR_RATE_WARNING" | bc -l) )); then
    echo -e "  ${YELLOW}🟡 警告: 错误率接近阈值 ($ERROR_RATE > $ERROR_RATE_WARNING %)${NC}"
  else
    echo -e "  ${GREEN}✅ 错误率正常${NC}"
  fi
  
  # 资源使用
  echo ""
  echo "  📊 资源使用情况:"
  for pod in $CANARY_PODS; do
    METRICS=$(kubectl top pod "$pod" -n production 2>/dev/null)
    if [ ! -z "$METRICS" ]; then
      echo "    $pod: $(echo $METRICS | awk 'NR>1 {print $2 "Mi / " $3 "m"}')"
    fi
  done
  
  echo ""
  return 0
}

monitor_full() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🟢 全量环境监控 (Full Deployment)${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  REGIONS=("region-a" "region-b" "region-us" "region-eu")
  
  for region in "${REGIONS[@]}"; do
    PODS=$(kubectl get pods -n production-$region -l app=vxin-backend -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
    REPLICA_COUNT=$(echo $PODS | wc -w)
    
    if [ "$REPLICA_COUNT" -eq 0 ]; then
      echo "  📍 $region: ⚠️  无运行 Pod"
      continue
    fi
    
    # 获取该区域的平均延迟和错误率
    REGION_LATENCIES=()
    REGION_ERRORS=0
    REGION_REQUESTS=0
    
    for pod in $PODS; do
      POD_LOGS=$(kubectl logs "$pod" -n production-$region --tail=50 2>/dev/null)
      POD_LATENCY=$(echo "$POD_LOGS" | grep -oP 'latency=\K[0-9]+' | tail -1 || echo "0")
      POD_ERRORS=$(echo "$POD_LOGS" | grep -c "ERROR" || echo "0")
      POD_REQUESTS=$(echo "$POD_LOGS" | grep -c "request" || echo "1")
      
      REGION_LATENCIES+=($POD_LATENCY)
      REGION_ERRORS=$((REGION_ERRORS + POD_ERRORS))
      REGION_REQUESTS=$((REGION_REQUESTS + POD_REQUESTS))
    done
    
    # 计算平均延迟
    TOTAL_LATENCY=0
    for lat in "${REGION_LATENCIES[@]}"; do
      TOTAL_LATENCY=$((TOTAL_LATENCY + lat))
    done
    AVG_LATENCY=$((TOTAL_LATENCY / REPLICA_COUNT))
    
    REGION_ERROR_RATE=$(echo "scale=2; ($REGION_ERRORS / $REGION_REQUESTS) * 100" | bc -l 2>/dev/null || echo "0")
    
    # 状态指示
    if (( $(echo "$AVG_LATENCY > $LATENCY_CRITICAL" | bc -l) )); then
      STATUS="${RED}🔴${NC}"
    elif (( $(echo "$AVG_LATENCY > $LATENCY_WARNING" | bc -l) )); then
      STATUS="${YELLOW}🟡${NC}"
    else
      STATUS="${GREEN}✅${NC}"
    fi
    
    echo "  $STATUS 📍 $region | Pod: $REPLICA_COUNT | 延迟: ${AVG_LATENCY}ms | 错误率: ${REGION_ERROR_RATE}%"
  done
  
  echo ""
  return 0
}

monitor_database() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🗄️  数据库监控 (Database)${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  # 模拟数据库连接数
  DB_CONN=$(sqlite3 /root/v信/backend-v2/data/vxin.db "SELECT COUNT(*) FROM sqlite_master;" 2>/dev/null || echo "0")
  
  if [ "$DB_CONN" -gt 500 ]; then
    echo -e "  ${YELLOW}⚠️  数据库连接: $DB_CONN (接近限制 600)${NC}"
  else
    echo -e "  ${GREEN}✅ 数据库连接: $DB_CONN${NC}"
  fi
  
  echo ""
  return 0
}

monitor_redis() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}⚡ Redis 监控 (Redis Cache)${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  REDIS_INFO=$(redis-cli info stats 2>/dev/null)
  
  if [ -z "$REDIS_INFO" ]; then
    echo "  ⚠️  Redis 连接失败"
    echo ""
    return 1
  fi
  
  CACHE_HITS=$(echo "$REDIS_INFO" | grep "keyspace_hits" | awk -F: '{print $2}')
  CACHE_MISSES=$(echo "$REDIS_INFO" | grep "keyspace_misses" | awk -F: '{print $2}')
  
  if [ ! -z "$CACHE_HITS" ] && [ ! -z "$CACHE_MISSES" ]; then
    TOTAL=$((CACHE_HITS + CACHE_MISSES))
    if [ "$TOTAL" -gt 0 ]; then
      HIT_RATE=$(echo "scale=2; ($CACHE_HITS / $TOTAL) * 100" | bc -l 2>/dev/null || echo "0")
      
      if (( $(echo "$HIT_RATE < 90" | bc -l) )); then
        echo -e "  ${YELLOW}⚠️  缓存命中率: ${HIT_RATE}% (目标 >95%)${NC}"
      else
        echo -e "  ${GREEN}✅ 缓存命中率: ${HIT_RATE}%${NC}"
      fi
    fi
  fi
  
  echo ""
  return 0
}

monitor_system() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🖥️  系统监控 (System)${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  # CPU 使用率
  CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}' || echo "0")
  if (( $(echo "$CPU_USAGE > $CPU_CRITICAL" | bc -l) )); then
    echo -e "  ${RED}🔴 CPU: ${CPU_USAGE}% (超过 $CPU_CRITICAL%)${NC}"
  elif (( $(echo "$CPU_USAGE > $CPU_WARNING" | bc -l) )); then
    echo -e "  ${YELLOW}🟡 CPU: ${CPU_USAGE}% (接近 $CPU_WARNING%)${NC}"
  else
    echo -e "  ${GREEN}✅ CPU: ${CPU_USAGE}%${NC}"
  fi
  
  # 内存使用率
  MEMORY_USAGE=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
  if [ "$MEMORY_USAGE" -gt "$MEMORY_CRITICAL" ]; then
    echo -e "  ${RED}🔴 内存: ${MEMORY_USAGE}% (超过 $MEMORY_CRITICAL%)${NC}"
  elif [ "$MEMORY_USAGE" -gt "$MEMORY_WARNING" ]; then
    echo -e "  ${YELLOW}🟡 内存: ${MEMORY_USAGE}% (接近 $MEMORY_WARNING%)${NC}"
  else
    echo -e "  ${GREEN}✅ 内存: ${MEMORY_USAGE}%${NC}"
  fi
  
  # 磁盘使用率
  DISK_USAGE=$(df /root/v信/backend-v2 | awk 'NR==2 {print $5}' | sed 's/%//')
  if [ "$DISK_USAGE" -gt 80 ]; then
    echo -e "  ${YELLOW}⚠️  磁盘: ${DISK_USAGE}% (接近满载)${NC}"
  else
    echo -e "  ${GREEN}✅ 磁盘: ${DISK_USAGE}%${NC}"
  fi
  
  # 网络连接数
  CONN_COUNT=$(netstat -an | grep ESTABLISHED | wc -l)
  echo "  📊 网络连接: $CONN_COUNT"
  
  echo ""
  return 0
}

monitor_alerts() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}🔔 活跃告警 (Active Alerts)${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  # 获取 AlertManager 的活跃告警
  ALERTS=$(curl -s http://localhost:9093/api/v1/alerts 2>/dev/null | grep -o '"status":"active"' | wc -l || echo "0")
  
  if [ "$ALERTS" -gt 0 ]; then
    echo -e "  ${YELLOW}🟡 活跃告警: $ALERTS${NC}"
  else
    echo -e "  ${GREEN}✅ 无活跃告警${NC}"
  fi
  
  echo ""
  return 0
}

print_footer() {
  echo -e "${CYAN}────────────────────────────────────────────────────────────────────────────${NC}"
  echo "监控刷新: 每 30 秒自动更新一次"
  echo "日志文件: $MONITOR_LOG"
  echo "按 Ctrl+C 停止监控"
  echo -e "${CYAN}────────────────────────────────────────────────────────────────────────────${NC}"
}

# 主监控循环
monitor_loop() {
  while true; do
    print_header
    
    monitor_canary
    monitor_full
    monitor_database
    monitor_redis
    monitor_system
    monitor_alerts
    
    print_footer
    
    # 记录日志
    {
      echo "============================================"
      echo "监控时间: $(date '+%Y-%m-%d %H:%M:%S')"
      echo "灰度环境 Pod 数: $(kubectl get pods -n production -l track=canary --no-headers 2>/dev/null | wc -l)"
      echo "全量环境 Pod 数: $(kubectl get pods -n production-region-a -l app=vxin-backend --no-headers 2>/dev/null | wc -l)"
    } >> "$MONITOR_LOG"
    
    sleep 30
  done
}

# 启动监控
monitor_loop
