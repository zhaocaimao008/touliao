#!/bin/bash

# 🚀 自动化部署启动脚本 - 一键启动所有自动化流程

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║       🚀 v信后端推送系统 - 完全自动化部署系统               ║"
echo "║                                                                ║"
echo "║          项目编号: VXIN-FCM-OPT-001                           ║"
echo "║          版本: 1.0.0                                          ║"
echo "║          自动部署：自动更新 → 自动测试 → 自动灰度上线      ║"
echo "║          自动监控：自动检测 → 自动告警 → 自动回滚           ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 验证脚本是否存在
if [ ! -f "auto-deploy.sh" ]; then
    echo "❌ 错误: auto-deploy.sh 不存在！"
    echo "请确保在项目目录中运行此脚本"
    exit 1
fi

echo "✅ 部署脚本已验证"
echo ""

# 选择部署方式
echo "请选择部署方式："
echo ""
echo "1️⃣  前台运行 (实时看到日志)"
echo "2️⃣  后台运行 (保存到文件，继续工作)"
echo "3️⃣  使用 tmux (可分离/重连，适合服务器)"
echo ""
read -p "请选择 (1/2/3): " choice

case $choice in
    1)
        echo ""
        echo "▶️  启动前台部署..."
        echo ""
        chmod +x auto-deploy.sh
        ./auto-deploy.sh
        ;;
    2)
        echo ""
        LOG_FILE="deployment_$(date +%Y%m%d_%H%M%S).log"
        echo "▶️  启动后台部署，日志保存到: $LOG_FILE"
        chmod +x auto-deploy.sh
        nohup ./auto-deploy.sh > "$LOG_FILE" 2>&1 &
        PID=$!
        echo "✅ 进程已启动 (PID: $PID)"
        echo ""
        echo "💡 查看日志的命令:"
        echo "  tail -f $LOG_FILE"
        echo ""
        echo "💡 查看实时指标的命令:"
        echo "  ./monitor-deployment.sh"
        echo ""
        echo "部署已在后台运行，你可以继续工作或关闭窗口"
        ;;
    3)
        echo ""
        if ! command -v tmux &> /dev/null; then
            echo "❌ tmux 未安装"
            echo "请先安装: sudo apt-get install tmux"
            exit 1
        fi
        
        echo "▶️  使用 tmux 启动部署..."
        chmod +x auto-deploy.sh
        tmux new-session -d -s deploy -c "$(pwd)" './auto-deploy.sh'
        echo "✅ tmux 会话已创建 (会话名: deploy)"
        echo ""
        echo "💡 查看部署进度的命令:"
        echo "  tmux attach-session -t deploy"
        echo ""
        echo "💡 分离会话（不停止部署）:"
        echo "  按 Ctrl+B，然后按 D"
        echo ""
        echo "部署已在 tmux 中运行"
        ;;
    *)
        echo "❌ 无效的选择"
        exit 1
        ;;
esac

echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📊 部署信息："
echo "  • 自动备份代码"
echo "  • 自动更新依赖"
echo "  • 自动运行测试"
echo "  • Phase 1: 5% 用户 (48小时)"
echo "  • Phase 2: 20% 用户 (48小时)"
echo "  • Phase 3: 100% 用户 (持续)"
echo "  • 每分钟检查指标"
echo "  • 自动故障回滚"
echo ""
echo "📖 完整指南: cat AUTOMATED_DEPLOYMENT_GUIDE.md"
echo "📖 快速启动: cat RUN_DEPLOYMENT.txt"
echo ""
echo "════════════════════════════════════════════════════════════════"

