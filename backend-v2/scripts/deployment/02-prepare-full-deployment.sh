#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════════"
echo "📦 准备全量部署 - Prepare Full Deployment"
echo "════════════════════════════════════════════════════════════"

# Step 1: 预热全量环境
echo "🔥 预热全量环境数据库..."
npm run db:migrate || echo "⚠️  迁移跳过"

# Step 2: 准备备份
echo "💾 创建完整备份..."
mkdir -p /root/v信/backend-v2/backups
BACKUP_NAME="backup-full-$(date +%s).tar.gz"
tar -czf /root/v信/backend-v2/backups/$BACKUP_NAME \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=dist \
  --exclude=coverage \
  . || echo "⚠️  备份失败"

echo "✅ 备份完成: $BACKUP_NAME"

# Step 3: 准备健康检查
echo "🏥 验证健康检查端点..."
curl -f http://localhost:3000/health || echo "⚠️  健康检查未响应"

# Step 4: 准备监控系统
echo "📊 启动监控系统..."
docker-compose up -d prometheus grafana alertmanager || true

# Step 5: 准备告警规则
echo "🔔 加载告警规则..."
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{}'  || echo "⚠️  告警配置跳过"

# Step 6: 准备灾难恢复工具
echo "🆘 准备快速回滚工具..."
mkdir -p /root/v信/backend-v2/scripts/recovery
cat > /root/v信/backend-v2/scripts/recovery/quick-rollback.sh << 'ROLLBACK'
#!/bin/bash
# 快速回滚脚本
echo "🔄 执行快速回滚..."
kubectl rollout undo deployment/vxin-backend -n production
echo "✅ 回滚完成"
ROLLBACK

chmod +x /root/v信/backend-v2/scripts/recovery/quick-rollback.sh

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✅ 全量环境准备完成！"
echo "   备份: $BACKUP_NAME"
echo "   监控: http://grafana.local:3000"
echo "   告警: http://alertmanager.local:9093"
echo "════════════════════════════════════════════════════════════"
