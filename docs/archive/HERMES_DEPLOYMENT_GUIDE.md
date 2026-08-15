# Hermes 部署指南 - V信后端 P3

## 📦 快速部署流程

### 1. 部署前准备

```bash
# 在 Hermes 上执行以下命令

# 拉取最新代码
git clone https://github.com/zhaocaimao008/vxin-1.0.git
cd vxin-1.0/backend-v2

# 运行部署前检查
bash scripts/pre-deploy-check.sh
```

### 2. 环境配置（关键步骤）

在目标服务器上创建生产环境配置：

```bash
# 创建配置目录
sudo mkdir -p /etc/vxin
sudo mkdir -p /var/lib/vxin/db
sudo mkdir -p /var/lib/vxin/logs
sudo mkdir -p /var/lib/vxin/uploads

# 创建环境文件
sudo tee /etc/vxin/.env.production > /dev/null << 'EOF'
# Node.js 环境
NODE_ENV=production
PORT=3002
DEBUG=false

# 数据库（必须）
DATABASE_PATH=/var/lib/vxin/db/vxin.db

# Redis（必须）
REDIS_URL=redis://localhost:6379

# JWT 密钥（必须生成新的，不要用开发环境的）
JWT_SECRET=generate-a-random-string-min-32-chars-here
REFRESH_TOKEN_SECRET=generate-another-random-string-here

# Sentry 错误追踪（可选）
SENTRY_DSN=https://your-key@your-project.ingest.sentry.io/your-id
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# 上传配置
UPLOADS_ROOT=/var/lib/vxin/uploads
MAX_UPLOAD_SIZE=52428800

# CORS 配置（重要：改为你的域名）
ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com

# 日志级别
LOG_LEVEL=info

# 日志路径
LOG_DIR=/var/lib/vxin/logs
EOF

# 设置权限
sudo chmod 600 /etc/vxin/.env.production
sudo chown vxin:vxin /etc/vxin/.env.production
```

### 3. Hermes 部署脚本示例

```bash
#!/bin/bash
# Hermes 调用的部署脚本

set -e

echo "🚀 V信后端开始部署..."
echo "时间: $(date)"

# 配置
APP_DIR="/root/v信/backend-v2"
ENV_FILE="/etc/vxin/.env.production"
LOG_FILE="/var/log/vxin-deploy.log"

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a $LOG_FILE
}

# 错误处理
trap 'log "❌ 部署失败！"; exit 1' ERR

# ============ 开始部署 ============

log "📋 步骤 1/7: 检查环境"
bash $APP_DIR/scripts/pre-deploy-check.sh

log "📥 步骤 2/7: 获取最新代码"
cd $APP_DIR
git fetch origin
git checkout main
git reset --hard origin/main

log "📦 步骤 3/7: 安装依赖"
# 清理旧依赖
rm -rf node_modules package-lock.json
# 安装新依赖（使用 ci 确保版本一致）
npm ci --only=production

log "🔧 步骤 4/7: 初始化数据库（如需要）"
# 如果是首次部署，取消下面的注释
# npm run db:init

log "🛑 步骤 5/7: 停止旧应用"
# 使用 systemd 停止
sudo systemctl stop vxin-backend || true

# 或使用 PM2
# pm2 stop vxin-backend || true

# 或直接杀死进程
# pkill -f "npm start -- /root/v信/backend-v2" || true

# 等待进程完全停止
sleep 2

log "🚀 步骤 6/7: 启动新应用"
# 使用 systemd 启动
sudo systemctl start vxin-backend

# 或使用 PM2
# pm2 start ecosystem.config.js

# 等待应用启动
sleep 5

log "✅ 步骤 7/7: 验证部署"

# 健康检查
for i in {1..10}; do
    if curl -s http://localhost:3002/health | grep -q "ok"; then
        log "✅ 应用健康检查通过！"
        break
    fi
    log "等待应用启动... ($i/10)"
    sleep 1
done

# 检查日志是否有错误
if tail -20 /var/lib/vxin/logs/error.log 2>/dev/null | grep -q "ERROR"; then
    log "⚠️  错误日志中有错误信息，请检查！"
else
    log "✅ 错误日志检查通过"
fi

log "================================"
log "🎉 部署成功！"
log "时间: $(date)"
log "================================"

# 发送部署通知（可选）
curl -X POST https://your-notification-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "status": "success",
    "service": "vxin-backend",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' || true

exit 0
```

## 🔧 Systemd 服务配置

创建 `/etc/systemd/system/vxin-backend.service`：

```ini
[Unit]
Description=V信后端服务
After=network.target redis.service
Wants=redis.service

[Service]
Type=simple
User=vxin
Group=vxin
WorkingDirectory=/root/v信/backend-v2

# 环境变量
EnvironmentFile=/etc/vxin/.env.production

# 启动命令
ExecStart=/usr/bin/npm start

# 重启策略
Restart=on-failure
RestartSec=5s
StartLimitInterval=60s
StartLimitBurst=3

# 资源限制
LimitNOFILE=65536

# 日志
StandardOutput=journal
StandardError=journal
SyslogIdentifier=vxin-backend

[Install]
WantedBy=multi-user.target
```

启用并启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable vxin-backend
sudo systemctl start vxin-backend

# 查看状态
sudo systemctl status vxin-backend

# 查看日志
sudo journalctl -u vxin-backend -f
```

## 🎯 PM2 配置方案

如果使用 PM2 而不是 systemd：

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [
    {
      name: 'vxin-backend',
      script: './src/server.js',
      instances: 4,
      instance_var: 'INSTANCE_ID',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/var/lib/vxin/logs/pm2-error.log',
      out_file: '/var/lib/vxin/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      watch: false,
      ignore_watch: ['node_modules', 'logs'],
      max_restarts: 10,
      min_uptime: '10s',
      autorestart: true,
    },
  ],

  deploy: {
    production: {
      user: 'vxin',
      host: 'your-server-ip',
      ref: 'origin/main',
      repo: 'https://github.com/zhaocaimao008/vxin-1.0.git',
      path: '/root/v信',
      'pre-deploy-local': 'echo "部署开始"',
      'post-deploy': 'npm ci && npm run db:migrate && pm2 reload ecosystem.config.js --env production',
    },
  },
};
```

启动：

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

## 📊 监控和告警配置

### Grafana 仪表板自动启动

```bash
# 在应用启动脚本中添加

# 启动 Prometheus
docker-compose -f grafana/docker-compose.yml up -d

# 或使用系统服务
sudo systemctl start prometheus
sudo systemctl start grafana-server
```

### 日志和错误追踪

```bash
# ELK Stack 启动
docker-compose -f elk/docker-compose.yml up -d

# 验证 Elasticsearch 连接
curl http://localhost:9200/_cluster/health

# 验证 Kibana
curl http://localhost:5601/api/status
```

## 🔄 零停机部署

如果需要零停机更新（使用负载均衡器）：

```bash
#!/bin/bash
# 蓝绿部署脚本

# 当前版本（绿）运行在端口 3002
# 新版本（蓝）运行在端口 3003

GREEN_PORT=3002
BLUE_PORT=3003

echo "启动新版本（蓝）在端口 $BLUE_PORT..."
PORT=$BLUE_PORT npm start &
BLUE_PID=$!

# 等待蓝版本启动
sleep 5

# 验证蓝版本健康
if curl -s http://localhost:$BLUE_PORT/health | grep -q "ok"; then
    echo "✅ 蓝版本健康检查通过"
    
    # 使用负载均衡器切换流量（需要手动或自动化操作）
    # 例如更新 Nginx 配置指向新端口
    
    # 等待现有连接完成（优雅关闭）
    sleep 30
    
    # 停止绿版本
    kill $GREEN_PID || true
    
    echo "✅ 零停机部署完成"
else
    echo "❌ 蓝版本健康检查失败，回滚"
    kill $BLUE_PID
    exit 1
fi
```

## 🚨 部署失败回滚

如果部署出现问题：

```bash
#!/bin/bash
# 快速回滚脚本

APP_DIR="/root/v信/backend-v2"
BACKUP_DIR="/root/v信/backup"

echo "⚠️  开始回滚..."

# 1. 停止当前应用
sudo systemctl stop vxin-backend

# 2. 恢复上一个版本
cd $APP_DIR
git reset --hard HEAD~1

# 3. 重新安装依赖
rm -rf node_modules
npm ci --only=production

# 4. 启动应用
sudo systemctl start vxin-backend

# 5. 验证
sleep 3
if curl -s http://localhost:3002/health | grep -q "ok"; then
    echo "✅ 回滚成功！"
else
    echo "❌ 回滚失败，需要手动检查"
    exit 1
fi
```

## 📝 部署清单

在 Hermes 执行部署前，确保以下项目已完成：

- [ ] 代码已推送到 GitHub
- [ ] `.env.production` 已配置（所有必要变量）
- [ ] Redis 服务已启动
- [ ] 数据库备份已完成
- [ ] SSL/HTTPS 证书已配置
- [ ] 日志目录已创建（`/var/lib/vxin/logs`）
- [ ] 上传目录已创建（`/var/lib/vxin/uploads`）
- [ ] Systemd/PM2 配置已准备
- [ ] Grafana 和 ELK 堆栈配置已准备
- [ ] 负载均衡器配置已准备

## 🎯 部署后验证

```bash
#!/bin/bash
# 部署后验证脚本

echo "🔍 部署后验证"
echo "================================"

# 1. 进程检查
echo "1. 进程状态:"
ps aux | grep "npm start" | grep -v grep || echo "❌ 进程未运行"

# 2. 端口检查
echo -e "\n2. 端口监听:"
netstat -tulpn | grep 3002 || echo "❌ 端口未监听"

# 3. 健康检查
echo -e "\n3. 应用健康检查:"
curl -s http://localhost:3002/health | jq . || echo "❌ 健康检查失败"

# 4. API 端点
echo -e "\n4. API 可用性:"
curl -s http://localhost:3002/api/metrics | jq '.requests_total' || echo "❌ API 不可用"

# 5. 日志检查
echo -e "\n5. 错误日志:"
tail -5 /var/lib/vxin/logs/error.log | grep -q "ERROR" && echo "⚠️  有错误日志" || echo "✅ 无错误"

# 6. 数据库连接
echo -e "\n6. 数据库连接:"
sqlite3 /var/lib/vxin/db/vxin.db ".tables" | wc -w

# 7. Redis 连接
echo -e "\n7. Redis 连接:"
redis-cli ping || echo "❌ Redis 连接失败"

echo -e "\n================================"
echo "验证完成！"
```

## 📞 支持和故障排查

**常见问题**：

1. **应用无法启动**
   ```bash
   tail -f /var/lib/vxin/logs/error.log
   ```

2. **数据库错误**
   ```bash
   sqlite3 /var/lib/vxin/db/vxin.db ".tables"
   ```

3. **Redis 连接失败**
   ```bash
   redis-cli ping
   ```

4. **端口被占用**
   ```bash
   lsof -i :3002
   ```

---

**关键提示**：
- ✅ 总是在部署前运行 `pre-deploy-check.sh`
- ✅ 部署新版本前备份数据库
- ✅ 使用 systemd 或 PM2 管理进程，确保自动重启
- ✅ 配置日志聚合和错误追踪，及时发现问题
- ✅ 准备好回滚脚本，以防万一
