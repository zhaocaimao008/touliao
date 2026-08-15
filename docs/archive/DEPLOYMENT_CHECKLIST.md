# V信后端 GitHub Actions 自动部署检查清单

## ✅ 已完成的工作（你无需操作）

- ✅ 创建了 GitHub Actions 工作流（`.github/workflows/deploy.yml`）
- ✅ 编写了详细配置文档（`.github/DEPLOYMENT_SETUP.md`）
- ✅ 提供了快速参考指南（`.github/QUICK_START.md`）
- ✅ 创建了配置向导脚本（`scripts/setup-deployment.sh`）
- ✅ 提交了所有文件到 Git

## 🚀 立即需要做的事（3 个步骤）

### 第 1 步：推送到 GitHub（必需）

```bash
cd /root/v信
git push origin main
```

### 第 2 步：生成和配置 SSH 密钥（必需）

**自动配置（推荐）**：
```bash
bash /root/v信/scripts/setup-deployment.sh
```

**手动配置**：
```bash
ssh-keygen -t ed25519 -f ~/.ssh/vxin-deploy -C "vxin-backend-deploy"
# 按 Enter（不设置密码）

# 查看需要的值
cat ~/.ssh/vxin-deploy          # 复制到 DEPLOY_SSH_KEY
cat ~/.ssh/vxin-deploy.pub      # 复制到服务器
```

### 第 3 步：在 GitHub 添加 Secrets（必需）

进入：**GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret**

| Secret 名称 | 值 |
|---|---|
| `DEPLOY_SSH_KEY` | `~/.ssh/vxin-deploy` 的完整内容 |
| `DEPLOY_SERVER_HOST` | 你的服务器 IP（如 `123.45.67.89`） |
| `DEPLOY_USER` | SSH 用户名（通常 `root`） |

### 第 4 步：在服务器上添加公钥（必需）

```bash
ssh root@<你的服务器IP>
cat << 'EOF' >> ~/.ssh/authorized_keys
<粘贴 ~/.ssh/vxin-deploy.pub 的内容>
EOF
chmod 600 ~/.ssh/authorized_keys
exit
```

### 第 5 步：测试自动部署（验证）

```bash
cd /root/v信
git add .
git commit -m "test: trigger automatic deployment"
git push origin main
```

然后检查 GitHub → Actions 标签，查看工作流运行状态。

---

## 📋 部署前必检项

### 1. 环境变量配置 ⚠️ 关键

```bash
# .env.production (生产环境)
NODE_ENV=production
PORT=3002
DEBUG=false

# 数据库
DATABASE_PATH=/var/lib/vxin/db/vxin.db

# Redis 连接
REDIS_URL=redis://redis:6379

# JWT 密钥（生成新的，不要用开发环境的）
JWT_SECRET=your-production-secret-key-min-32-chars
REFRESH_TOKEN_SECRET=your-refresh-secret-key-min-32-chars

# Sentry 错误追踪
SENTRY_DSN=https://your-key@your-project.ingest.sentry.io/your-id
SENTRY_ENVIRONMENT=production

# 上传配置
UPLOADS_ROOT=/var/lib/vxin/uploads
MAX_UPLOAD_SIZE=52428800  # 50MB

# CORS 允许的域名
ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com

# 日志级别
LOG_LEVEL=info
```

### 2. 数据库检查

- [ ] 确认 SQLite 数据库文件路径正确
- [ ] 数据库必须初始化（运行 migration）
- [ ] 备份生产数据库（如果是迁移）
- [ ] 检查数据库权限（755 或 775）

```bash
# 初始化数据库示例
node scripts/init-db.js
```

### 3. Redis 服务

- [ ] Redis 服务已启动并可访问
- [ ] Redis 密码配置正确（如果有）
- [ ] Redis 持久化配置（RDB 或 AOF）
- [ ] Redis 内存容量足够（建议 >= 512MB）

```bash
# 测试 Redis 连接
redis-cli ping
# 应该返回 PONG
```

### 4. Node.js 依赖

```bash
# 清理旧依赖
rm -rf node_modules package-lock.json

# 安装依赖
npm ci  # 使用 ci 而非 install（生产环境推荐）

# 验证关键包版本
npm list express socket.io sqlite3 redis
```

### 5. 系统资源要求

| 资源 | 最低要求 | 推荐 |
|------|----------|------|
| CPU | 2 核 | 4 核 |
| 内存 | 1 GB | 4 GB |
| 磁盘 | 10 GB | 50 GB |
| 网络 | 100 Mbps | 1 Gbps |

### 6. 网络和防火墙

- [ ] 后端服务端口 (3002) 已开放
- [ ] Redis 端口 (6379) 仅内网可访问
- [ ] 数据库文件不在网络可达位置
- [ ] HTTPS/SSL 证书已配置
- [ ] 代理服务器已配置（如 Nginx）

## 🔧 Hermes 部署配置

### 基础启动脚本

```bash
#!/bin/bash
set -e

# 1. 进入应用目录
cd /root/v信/backend-v2

# 2. 安装依赖
npm ci

# 3. 初始化数据库（首次部署）
# node scripts/init-db.js

# 4. 启动应用
npm start
```

### 环境隔离

```bash
# 建议使用 systemd 或 supervisor 管理进程
# 配置示例：/etc/systemd/system/vxin-backend.service

[Unit]
Description=V信后端服务
After=network.target redis.service
Wants=redis.service

[Service]
Type=simple
User=vxin
WorkingDirectory=/root/v信/backend-v2
EnvironmentFile=/etc/vxin/.env.production
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

## 📊 监控和日志

### 1. 日志输出位置

```
/root/v信/backend-v2/logs/
├── combined.log      # 所有日志
└── error.log         # 错误日志
```

### 2. 性能监控端点

```bash
# Prometheus 指标
curl http://localhost:3002/metrics

# JSON 格式指标
curl http://localhost:3002/api/metrics

# 健康检查
curl http://localhost:3002/health
```

### 3. Sentry 集成验证

```bash
# 部署后验证 Sentry 连接
curl -X POST http://localhost:3002/api/test-sentry \
  -H "Authorization: Bearer admin-token"
```

## 🚀 分步部署流程

### 阶段 1: 准备 (Pre-deployment)

- [ ] 代码审查完成
- [ ] 环境变量文件准备
- [ ] 数据库备份完成
- [ ] Redis 服务已就绪
- [ ] SSL/HTTPS 证书已配置

### 阶段 2: 部署 (Deployment)

```bash
# 1. 获取最新代码
git pull origin main

# 2. 清理旧依赖
rm -rf node_modules

# 3. 安装新依赖
npm ci

# 4. 运行数据库迁移（如果有）
npm run db:migrate

# 5. 启动应用
npm start
```

### 阶段 3: 验证 (Validation)

- [ ] 应用进程正常运行
- [ ] 访问 http://localhost:3002/health 返回 200
- [ ] 查看 logs/combined.log 无错误
- [ ] API 端点正常响应（测试几个端点）
- [ ] Sentry 自动捕获测试异常成功
- [ ] 数据库连接正常

### 阶段 4: 平滑切换 (Smooth Transition)

如果有旧版本运行：

```bash
# 1. 启动新版本（并行运行）
PORT=3003 npm start &

# 2. 运行 E2E 测试验证
npm test test/e2e.test.js

# 3. 流量逐步切换（使用负载均衡器）
# 10% → 50% → 100%

# 4. 确认稳定后停止旧版本
pkill -f "npm start" --old-version
```

## ⚠️ 常见问题排查

### 应用无法启动

```bash
# 1. 检查端口是否被占用
lsof -i :3002

# 2. 检查环境变量
echo $DATABASE_PATH
echo $REDIS_URL

# 3. 检查日志
tail -f logs/error.log

# 4. 检查权限
ls -la logs/
chmod 755 logs/
```

### 数据库错误

```bash
# 1. 检查数据库文件是否存在
ls -la /var/lib/vxin/db/vxin.db

# 2. 检查权限
chmod 644 /var/lib/vxin/db/vxin.db

# 3. 尝试打开数据库
sqlite3 /var/lib/vxin/db/vxin.db ".tables"
```

### Redis 连接失败

```bash
# 1. 检查 Redis 是否运行
redis-cli ping

# 2. 检查连接字符串
echo $REDIS_URL
# 应该是：redis://redis:6379

# 3. 测试连接
npm run test:redis
```

### 内存泄漏

```bash
# 1. 监控内存使用
ps aux | grep node
# 检查 RSS (驻留集大小)

# 2. 启用 Sentry 性能监控
# 在 SENTRY_DSN 配置中设置 tracesSampleRate

# 3. 检查日志中的 slow query 警告
grep "slow" logs/combined.log
```

## 🔐 安全检查

- [ ] JWT_SECRET 已更改（不是默认值）
- [ ] REDIS_URL 使用 localhost（不对外暴露）
- [ ] 数据库文件权限正确（644）
- [ ] 日志文件不包含敏感信息
- [ ] CORS_ORIGIN 已限制（不是 *)
- [ ] API 速率限制已启用
- [ ] HTTPS/SSL 已配置
- [ ] 环境变量文件 (.env) 已加入 .gitignore
- [ ] 密钥管理系统已配置（如 Vault）

## 📈 性能调优

### Node.js 进程

```bash
# 增加文件描述符限制
ulimit -n 65536

# 设置最大内存
NODE_OPTIONS="--max-old-space-size=2048" npm start
```

### Nginx 反向代理配置

```nginx
upstream vxin_backend {
    server localhost:3002 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://vxin_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # 超时配置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

## 📢 部署后通知

部署完成后的验证项：

```bash
#!/bin/bash

echo "🔍 部署验证清单"
echo "===================="

# 1. 健康检查
echo -n "健康检查: "
curl -s http://localhost:3002/health | grep -q "ok" && echo "✅" || echo "❌"

# 2. API 文档
echo -n "API 文档: "
curl -s http://localhost:3002/api-docs | grep -q "swagger" && echo "✅" || echo "❌"

# 3. 指标端点
echo -n "Prometheus 指标: "
curl -s http://localhost:3002/metrics | grep -q "http_requests_total" && echo "✅" || echo "❌"

# 4. 错误日志
echo -n "错误日志检查: "
tail -1 logs/error.log | grep -q "error" && echo "⚠️ 有错误" || echo "✅"

# 5. 进程内存
echo -n "进程内存: "
ps aux | grep "npm start" | grep -v grep | awk '{print $6 " MB"}'

echo "===================="
echo "部署验证完成！"
```

## 📝 回滚计划

如果部署出现问题：

```bash
# 1. 立即停止新版本
systemctl stop vxin-backend

# 2. 恢复旧版本
git checkout previous-commit-hash
npm ci
npm start

# 3. 分析问题
tail -f logs/error.log

# 4. 修复问题后重新部署
git pull origin main
npm ci
npm start
```

## 🎯 关键提示

> ⚠️ **部署前必做**
> 1. **备份数据库** - 至关重要
> 2. **设置新的 JWT 密钥** - 不要用开发环境的
> 3. **配置 Sentry DSN** - 获取 URL
> 4. **验证 Redis 连接** - 确保可达
> 5. **测试健康检查端点** - 部署完成后的第一步

> 💡 **最佳实践**
> - 使用 systemd/supervisor 管理进程
> - 配置自动重启（Restart=on-failure）
> - 使用 Nginx 反向代理 + 负载均衡
> - 启用性能监控（Grafana + Prometheus）
> - 配置日志聚合（ELK 或其他）
> - 定期备份数据库（每天一次）

---

**部署成功的标志**：
✅ 应用启动无错误  
✅ 健康检查 200 OK  
✅ 可以访问 API 文档  
✅ Sentry 接收错误事件  
✅ Prometheus 指标可用  
✅ 数据库查询正常  

有问题？检查 `logs/error.log` 和 `logs/combined.log`！
