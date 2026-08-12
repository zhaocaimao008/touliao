#!/bin/bash

##############################################################################
# v信后端 P1-P14 灰度+全量并行部署 - 立即启动
# 一键启动灰度与全量同步部署
##############################################################################

set -e

DEPLOY_START=$(date +%s)
DEPLOY_TIME=$(date '+%Y-%m-%d %H:%M:%S')

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ============================================================================
# 启动画面
# ============================================================================

clear
echo -e "${CYAN}"
cat << 'BANNER'
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║                  🚀🚀🚀 v信后端部署系统 - 立即启动 🚀🚀🚀                 ║
║                                                                            ║
║           v信后端 P1-P14 灰度+全量并行部署执行系统                         ║
║                   Parallel Canary + Full Deployment                       ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

echo ""
echo -e "${BLUE}部署配置信息:${NC}"
echo "  启动时间: $DEPLOY_TIME"
echo "  部署模式: 灰度 + 全量 并行部署"
echo "  总耗时: ~2.5 小时 (145 分钟)"
echo "  风险等级: 🔴 高风险 (需要强监控)"
echo ""

# ============================================================================
# 启动前检查
# ============================================================================

echo -e "${YELLOW}⏳ 执行启动前检查...${NC}"
echo ""

# 检查 1: 项目目录
if [ ! -d "/root/v信/backend-v2" ]; then
  echo -e "${RED}❌ 项目目录不存在${NC}"
  exit 1
fi

echo "✅ 项目目录存在"

# 检查 2: 脚本文件
REQUIRED_SCRIPTS=(
  "scripts/deployment/00-pre-deployment-check.sh"
  "scripts/deployment/01-deploy-canary-5percent.sh"
  "scripts/deployment/02-prepare-full-deployment.sh"
  "scripts/deployment/03-validate-canary.sh"
  "scripts/deployment/main-parallel-deploy.sh"
  "scripts/deployment/realtime-monitor.sh"
  "scripts/deployment/rollback-procedures.sh"
)

for script in "${REQUIRED_SCRIPTS[@]}"; do
  if [ ! -f "/root/v信/backend-v2/$script" ]; then
    echo -e "${RED}❌ 脚本缺失: $script${NC}"
    exit 1
  fi
done

echo "✅ 所有部署脚本就绪"

# 检查 3: 配置文件
if [ ! -f "/root/v信/backend-v2/.env" ]; then
  echo -e "${RED}❌ .env 配置文件不存在${NC}"
  exit 1
fi

echo "✅ 配置文件就绪"

# 检查 4: 备份目录
if [ ! -d "/root/v信/backend-v2/backups" ]; then
  mkdir -p /root/v信/backend-v2/backups
  echo "✅ 备份目录已创建"
else
  echo "✅ 备份目录存在"
fi

echo ""
echo -e "${GREEN}✅ 启动前检查通过！${NC}"
echo ""

# ============================================================================
# 最终确认
# ============================================================================

echo -e "${YELLOW}⚠️  最终确认${NC}"
echo ""
echo "请确认以下事项:"
echo "  ✓ 已阅读完整部署计划 (PARALLEL-DEPLOYMENT-PLAN.md)"
echo "  ✓ 已阅读执行指南 (DEPLOYMENT-EXECUTION-GUIDE.md)"
echo "  ✓ 数据库备份已完成"
echo "  ✓ 监控系统已就绪"
echo "  ✓ 团队成员已分配"
echo "  ✓ 紧急回滚方案已准备"
echo ""

read -p "确认准备就绪？(yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo -e "${YELLOW}⚠️  部署已取消${NC}"
  exit 0
fi

echo ""

# ============================================================================
# 启动部署
# ============================================================================

cd /root/v信/backend-v2

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🚀 启动灰度+全量并行部署...${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# 在后台启动部署，同时记录 PID
./scripts/deployment/main-parallel-deploy.sh &
DEPLOY_PID=$!

echo -e "${GREEN}✅ 部署已启动${NC}"
echo ""
echo "部署进程 PID: $DEPLOY_PID"
echo "部署日志: tail -f /tmp/deployment-logs/main-*.log"
echo ""

# ============================================================================
# 提示信息
# ============================================================================

echo -e "${CYAN}提示信息:${NC}"
echo ""
echo "【在新终端中执行以下命令进行实时监控】"
echo ""
echo -e "${YELLOW}终端 2 - 实时监控:${NC}"
echo "  cd /root/v信/backend-v2"
echo "  ./scripts/deployment/realtime-monitor.sh"
echo ""
echo -e "${YELLOW}终端 3 - 快速回滚 (如需要):${NC}"
echo "  cd /root/v信/backend-v2"
echo "  ./scripts/deployment/rollback-procedures.sh"
echo ""
echo -e "${YELLOW}查看部署日志:${NC}"
echo "  tail -f /tmp/deployment-logs/main-*.log"
echo "  tail -f /tmp/deployment-logs/canary-*.log"
echo "  tail -f /tmp/deployment-logs/full-*.log"
echo ""

# ============================================================================
# 等待部署完成
# ============================================================================

echo -e "${BLUE}等待部署完成中...${NC}"
echo ""

# 跟踪部署进度
while kill -0 $DEPLOY_PID 2>/dev/null; do
  # 显示进度
  ELAPSED=$(($(date +%s) - DEPLOY_START))
  ELAPSED_MIN=$((ELAPSED / 60))
  ELAPSED_SEC=$((ELAPSED % 60))
  
  printf "\r⏱️  已运行时间: %02d:%02d | 预计总耗时: 145 分钟" $ELAPSED_MIN $ELAPSED_SEC
  
  sleep 5
done

echo ""
echo ""

# 获取部署结果
wait $DEPLOY_PID
DEPLOY_RESULT=$?

DEPLOY_END=$(date +%s)
DEPLOY_DURATION=$((DEPLOY_END - DEPLOY_START))
DEPLOY_MINUTES=$((DEPLOY_DURATION / 60))
DEPLOY_SECONDS=$((DEPLOY_DURATION % 60))

# ============================================================================
# 部署结果
# ============================================================================

echo ""
echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"

if [ $DEPLOY_RESULT -eq 0 ]; then
  echo -e "${GREEN}🎉 部署成功！${NC}"
  echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "部署统计:"
  echo "  启动时间: $(date -d @$DEPLOY_START '+%Y-%m-%d %H:%M:%S')"
  echo "  完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "  总耗时: ${DEPLOY_MINUTES}m ${DEPLOY_SECONDS}s"
  echo ""
  echo "部署结果:"
  echo "  ✅ 灰度 5% - 验证通过"
  echo "  ✅ 灰度 50% - 验证通过"
  echo "  ✅ 灰度 100% - 验证通过"
  echo "  ✅ 全量 5% - 验证通过"
  echo "  ✅ 全量 50% - 验证通过"
  echo "  ✅ 全量 100% - 验证通过"
  echo "  ✅ 最终验证 - 通过"
  echo ""
  echo "下一步行动:"
  echo "  1. 启动 24h 监控期"
  echo "  2. 执行部署后验证"
  echo "  3. 收集业务数据反馈"
  echo "  4. 准备事后分析总结"
  echo ""
else
  echo -e "${RED}❌ 部署失败！${NC}"
  echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "部署统计:"
  echo "  启动时间: $(date -d @$DEPLOY_START '+%Y-%m-%d %H:%M:%S')"
  echo "  失败时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "  运行时长: ${DEPLOY_MINUTES}m ${DEPLOY_SECONDS}s"
  echo ""
  echo "故障排查:"
  echo "  1. 查看部署日志："
  echo "     tail -100 /tmp/deployment-logs/main-*.log"
  echo "  2. 启动实时监控:"
  echo "     ./scripts/deployment/realtime-monitor.sh"
  echo "  3. 执行紧急回滚:"
  echo "     ./scripts/deployment/rollback-procedures.sh"
  echo ""
fi

echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
echo ""

# 记录最终状态
{
  echo "部署完成"
  echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "耗时: ${DEPLOY_MINUTES}m ${DEPLOY_SECONDS}s"
  echo "结果: $([ $DEPLOY_RESULT -eq 0 ] && echo '成功' || echo '失败')"
} >> /tmp/deployment-final-status.log

exit $DEPLOY_RESULT
