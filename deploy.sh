#!/bin/bash
# ⚠️ 已废弃（DEPRECATED）——请勿使用。
#
# 此脚本指向的是【旧服务器 / 旧进程】：/var/www/vxin/、pm2 `vxin-server`、
# 104.244.95.70:8086，均与当前生产环境不符。
# 当前生产部署统一走 GitHub Actions（.github/workflows/deploy.yml）：
#   git push origin main  →  CI 门禁全绿  →  SSH 部署到香港服务器（pm2 vxin-server-v2 :3002）
# 回滚请用：bash deploy/rollback.sh
#
# 保留此文件仅为历史留痕；直接运行会立即退出，防止误部署到错误目标。
set -e
echo "❌ deploy.sh 已废弃，请勿使用。"
echo "   生产部署：git push origin main（走 .github/workflows/deploy.yml）"
echo "   回滚：bash deploy/rollback.sh"
exit 1
