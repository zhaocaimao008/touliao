#!/bin/bash

# 部署监控脚本 - 实时监控部署状态
# 用途: 在部署期间持续监控关键指标，自动检测问题

PROJECT_DIR="/root/v信/backend-v2"
METRICS_LOG="$PROJECT_DIR/metrics.log"
ALERT_LOG="$PROJECT_DIR/alerts.log"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

check_metrics() {
    # 获取FCM指标
    METRICS=$(curl -s http://127.0.0.1:3000/api/metrics 2>/dev/null)
    
    if [ -z "$METRICS" ]; then
        echo -e "${RED}❌ 无法连接到服务${NC}"
        return 1
    fi
    
    # 解析指标
    SUCCESS_RATE=$(echo "$METRICS" | jq '.fcm.successRate // 0' 2>/dev/null)
    AVG_LATENCY=$(echo "$METRICS" | jq '.fcm.avgLatency // 0' 2>/dev/null)
    ERROR_RATE=$(echo "$METRICS" | jq '.fcm.errorRate // 0' 2>/dev/null)
    
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    
    # 记录指标
    echo "[$TIMESTAMP] SUCCESS_RATE=$SUCCESS_RATE AVG_LATENCY=$AVG_LATENCY ERROR_RATE=$ERROR_RATE" >> "$METRICS_LOG"
    
    # 显示指标
    echo -e "${GREEN}[$TIMESTAMP]${NC} 指标采样"
    echo "  成功率: $SUCCESS_RATE%"
    echo "  延迟: ${AVG_LATENCY}ms"
    echo "  错误率: $ERROR_RATE%"
    
    # 检查告警条件
    if (( $(echo "$SUCCESS_RATE < 95" | bc -l 2>/dev/null || echo "0") )); then
        echo -e "${RED}⚠️  告警: 成功率过低 ($SUCCESS_RATE < 95%)${NC}"
        echo "[$TIMESTAMP] ALERT: Low success rate $SUCCESS_RATE" >> "$ALERT_LOG"
    fi
    
    if (( $(echo "$AVG_LATENCY > 200" | bc -l 2>/dev/null || echo "0") )); then
        echo -e "${RED}⚠️  告警: 延迟过高 ($AVG_LATENCY > 200ms)${NC}"
        echo "[$TIMESTAMP] ALERT: High latency $AVG_LATENCY" >> "$ALERT_LOG"
    fi
    
    if (( $(echo "$ERROR_RATE > 5" | bc -l 2>/dev/null || echo "0") )); then
        echo -e "${RED}⚠️  告警: 错误率过高 ($ERROR_RATE > 5%)${NC}"
        echo "[$TIMESTAMP] ALERT: High error rate $ERROR_RATE" >> "$ALERT_LOG"
    fi
}

# 持续监控
echo "🔍 部署监控开始..."
echo "按 Ctrl+C 停止监控"

while true; do
    check_metrics
    echo "---"
    sleep 60
done
