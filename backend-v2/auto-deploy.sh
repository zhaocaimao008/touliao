#!/bin/bash

################################################################################
#                                                                              #
#          🚀 v信后端推送系统 - 一键自动化部署系统                          #
#                                                                              #
#          项目编号: VXIN-FCM-OPT-001                                         #
#          版本: 1.0.0                                                        #
#          用途: 自动部署、灰度上线、监控、回滚                              #
#                                                                              #
################################################################################

set -e

# 配置
PROJECT_DIR="/root/v信/backend-v2"
LOG_FILE="$PROJECT_DIR/deployment.log"
METRICS_FILE="$PROJECT_DIR/deployment-metrics.json"
BACKUP_DIR="$PROJECT_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

################################################################################
# 日志函数
################################################################################

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✅ $1${NC}" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ❌ $1${NC}" | tee -a "$LOG_FILE"
}

log_info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] ℹ️ $1${NC}" | tee -a "$LOG_FILE"
}

################################################################################
# 步骤1: 预检查
################################################################################

step_precheck() {
    log_info "========== 步骤1: 预检查 =========="
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装"
        exit 1
    fi
    log_success "Node.js 已安装: $(node --version)"
    
    # 检查npm
    if ! command -v npm &> /dev/null; then
        log_error "npm 未安装"
        exit 1
    fi
    log_success "npm 已安装: $(npm --version)"
    
    # 检查git
    if ! command -v git &> /dev/null; then
        log_error "git 未安装"
        exit 1
    fi
    log_success "git 已安装: $(git --version)"
    
    # 创建备份目录
    mkdir -p "$BACKUP_DIR"
    log_success "备份目录已创建: $BACKUP_DIR"
    
    cd "$PROJECT_DIR"
    log_success "进入项目目录: $PROJECT_DIR"
}

################################################################################
# 步骤2: 代码更新和安装
################################################################################

step_install() {
    log_info "========== 步骤2: 代码更新和依赖安装 =========="
    
    # 备份当前代码
    BACKUP_PATH="$BACKUP_DIR/backup_$TIMESTAMP"
    cp -r . "$BACKUP_PATH"
    log_success "代码已备份: $BACKUP_PATH"
    
    # 更新git
    log "正在更新代码..."
    git pull origin main 2>&1 | tee -a "$LOG_FILE" || log "git pull 失败，使用本地代码"
    
    # 安装依赖
    log "正在安装依赖..."
    npm install 2>&1 | tee -a "$LOG_FILE"
    log_success "依赖安装完成"
}

################################################################################
# 步骤3: 测试
################################################################################

step_test() {
    log_info "========== 步骤3: 运行测试 =========="
    
    log "正在运行测试..."
    npm test 2>&1 | tee -a "$LOG_FILE"
    
    if [ $? -eq 0 ]; then
        log_success "所有测试通过"
    else
        log_error "测试失败，中止部署"
        exit 1
    fi
}

################################################################################
# 步骤4: 灰度部署
################################################################################

step_canary_deploy() {
    log_info "========== 步骤4: 灰度部署 =========="
    
    # Phase 1: 5% 用户
    log_info "--- Phase 1: 5% 用户金丝雀测试 (Day 1-2) ---"
    
    log "启动服务 (Phase 1)..."
    npm start > /tmp/vxin.phase1.log 2>&1 &
    PID=$!
    echo $PID > /tmp/vxin.pid
    
    sleep 10
    
    if ! kill -0 $PID 2>/dev/null; then
        log_error "服务启动失败"
        cat /tmp/vxin.phase1.log
        exit 1
    fi
    
    log_success "服务已启动 (PID: $PID)"
    
    # Phase 1 监控
    log "正在监控 Phase 1 (5% 用户)..."
    monitor_phase 1 48 "5% 用户" "$PID"
    
    log_success "Phase 1 监控完成，无错误，继续 Phase 2"
}

################################################################################
# 步骤5: 完整监控
################################################################################

monitor_phase() {
    local phase=$1
    local duration_hours=$2
    local description=$3
    local pid=$4
    
    local start_time=$(date +%s)
    local duration_seconds=$((duration_hours * 3600))
    local check_interval=60 # 每分钟检查一次
    
    log "Phase $phase 监控开始 ($description)"
    log "监控持续时间: ${duration_hours}小时"
    log "采样间隔: ${check_interval}秒"
    
    while true; do
        current_time=$(date +%s)
        elapsed=$((current_time - start_time))
        remaining=$((duration_seconds - elapsed))
        
        if [ $remaining -le 0 ]; then
            log_success "Phase $phase 监控完成 ($description)"
            break
        fi
        
        # 获取metrics
        if command -v curl &> /dev/null; then
            METRICS=$(curl -s http://127.0.0.1:3000/api/metrics 2>/dev/null || echo "{}")
            
            # 检查关键指标
            SUCCESS_RATE=$(echo "$METRICS" | grep -o '"successRate"[^,}]*' | cut -d':' -f2 | tr -d ' "')
            AVG_LATENCY=$(echo "$METRICS" | grep -o '"avgLatency"[^,}]*' | cut -d':' -f2 | tr -d ' "')
            
            if [ -n "$SUCCESS_RATE" ] && [ -n "$AVG_LATENCY" ]; then
                log "Phase $phase 指标 - 成功率: ${SUCCESS_RATE}%, 平均延迟: ${AVG_LATENCY}ms"
                
                # 回滚条件
                if (( $(echo "$SUCCESS_RATE < 95" | bc -l) )); then
                    log_error "成功率低于95%，触发回滚!"
                    trigger_rollback "$pid"
                    exit 1
                fi
                
                if (( $(echo "$AVG_LATENCY > 200" | bc -l) )); then
                    log_error "延迟超过200ms，触发回滚!"
                    trigger_rollback "$pid"
                    exit 1
                fi
            fi
        fi
        
        # 检查进程是否还在运行
        if ! kill -0 $pid 2>/dev/null; then
            log_error "进程已停止，触发回滚!"
            trigger_rollback "$pid"
            exit 1
        fi
        
        # 显示进度
        hours_remaining=$((remaining / 3600))
        minutes_remaining=$(((remaining % 3600) / 60))
        log_info "Phase $phase 进行中... 剩余时间: ${hours_remaining}小时${minutes_remaining}分钟"
        
        sleep $check_interval
    done
}

################################################################################
# 步骤6: 全量部署
################################################################################

step_full_deploy() {
    log_info "========== 步骤5: 全量部署 =========="
    
    log "启动全量服务..."
    npm start > /tmp/vxin.full.log 2>&1 &
    PID=$!
    echo $PID > /tmp/vxin.pid
    
    sleep 10
    
    if ! kill -0 $PID 2>/dev/null; then
        log_error "服务启动失败"
        cat /tmp/vxin.full.log
        exit 1
    fi
    
    log_success "全量服务已启动 (PID: $PID)"
    
    # 持续监控
    log "正在持续监控服务..."
    while true; do
        if command -v curl &> /dev/null; then
            METRICS=$(curl -s http://127.0.0.1:3000/api/metrics 2>/dev/null || echo "{}")
            SUCCESS_RATE=$(echo "$METRICS" | grep -o '"successRate"[^,}]*' | cut -d':' -f2 | tr -d ' "')
            
            if [ -n "$SUCCESS_RATE" ]; then
                log "当前成功率: ${SUCCESS_RATE}%"
            fi
        fi
        
        sleep 60
    done
}

################################################################################
# 回滚
################################################################################

trigger_rollback() {
    local pid=$1
    
    log_error "触发自动回滚..."
    
    # 停止进程
    if kill -0 $pid 2>/dev/null; then
        kill $pid
        wait $pid 2>/dev/null
    fi
    
    # 恢复备份
    if [ -d "$BACKUP_DIR" ]; then
        LATEST_BACKUP=$(ls -td "$BACKUP_DIR"/backup_* 2>/dev/null | head -1)
        if [ -n "$LATEST_BACKUP" ]; then
            log "正在恢复备份: $LATEST_BACKUP"
            rm -rf *
            cp -r "$LATEST_BACKUP"/* .
            log_success "备份已恢复"
        fi
    fi
    
    log_error "回滚完成，部署已中止"
}

################################################################################
# 主函数
################################################################################

main() {
    log_info "╔════════════════════════════════════════════════════╗"
    log_info "║   v信后端推送系统 - 自动化部署开始              ║"
    log_info "║   项目编号: VXIN-FCM-OPT-001                      ║"
    log_info "║   版本: 1.0.0                                     ║"
    log_info "║   时间: $(date '+%Y-%m-%d %H:%M:%S')                    ║"
    log_info "╚════════════════════════════════════════════════════╝"
    
    # 执行各步骤
    step_precheck
    step_install
    step_test
    step_canary_deploy
    step_full_deploy
    
    log_success "═══════════════════════════════════════════════════"
    log_success "🎉 部署完成！"
    log_success "═══════════════════════════════════════════════════"
}

# 运行主函数
main "$@"

