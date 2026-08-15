# v信生产环境故障排除指南 — 白屏问题诊断

**问题**: 前端登录成功但页面白屏  
**根本原因**: 后端API返回 502 Bad Gateway  
**诊断时间**: 2026-06-11

---

## 问题诊断

### 当前状态
- ✅ 前端页面: 正常加载（React代码存在）
- ✅ HTTPS: 配置正确（Let's Encrypt证书）
- ✅ Nginx: 运行正常
- ❌ 后端API: 返回 502 Bad Gateway
- ❌ 登录后: 白屏（无数据）

### 问题流程
```
用户访问 https://dipsin.com/vxin/
    ↓
Nginx 返回 HTML + React 代码 ✅
    ↓
浏览器加载 React 应用
    ↓
React 初始化，调用 /api/health 等接口
    ↓
Nginx 尝试转发到后端 (127.0.0.1:3002)
    ↓
❌ 连接失败 → 502 Bad Gateway
    ↓
前端收不到数据 → 显示白屏
```

---

## 解决方案

### 方案 1: 后端服务未启动（最可能）

#### 症状
```
ps aux | grep node
# 输出为空（没有Node进程）

netstat -tlnp | grep 3002
# 无输出（3002端口未监听）

curl http://localhost:3002/health
# Connection refused
```

#### 解决步骤

```bash
# 1. 登录香港服务器
ssh root@香港服务器IP

# 2. 进入项目目录
cd /root/v信/backend-v2

# 3. 检查依赖
npm list | head -20

# 4. 安装依赖（如果缺失）
npm install

# 5. 启动后端服务（前台运行测试）
npm start

# 出现以下输出说明成功：
# ✅ Sentry 错误追踪已启用
# Express server listening on port 3002
# Database connected
# Redis connected
```

#### 后台持久化运行

**选项 A: 使用 PM2**

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start "npm start" --name "vxin-backend"

# 保存配置
pm2 save

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 list
pm2 logs vxin-backend
```

**选项 B: 使用 systemd**

```bash
# 创建服务文件
sudo nano /etc/systemd/system/vxin-backend.service
```

```ini
[Unit]
Description=v信 Backend Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/v信/backend-v2
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable vxin-backend
sudo systemctl start vxin-backend

# 查看状态
sudo systemctl status vxin-backend
sudo journalctl -u vxin-backend -f
```

**选项 C: 使用 Docker（推荐）**

```bash
# 在项目根目录创建 Dockerfile
cat > /root/v信/backend-v2/Dockerfile << 'DOCKERFILE'
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3002

CMD ["npm", "start"]
DOCKERFILE

# 构建镜像
docker build -t vxin-backend:latest .

# 运行容器
docker run -d \
  --name vxin-backend \
  --restart always \
  -p 3002:3002 \
  -e DATABASE_URL="..." \
  -e REDIS_URL="..." \
  vxin-backend:latest

# 查看日志
docker logs -f vxin-backend
```

---

### 方案 2: Nginx 配置错误

#### 症状
```
curl http://localhost:3002/health
# 返回 {"ok":true}  ✅ 后端正常

https://dipsin.com/api/health
# 返回 502 Bad Gateway ❌ Nginx配置错误
```

#### 检查 Nginx 配置

```bash
# 查看配置文件
cat /etc/nginx/conf.d/dipsin.conf
# 或
cat /etc/nginx/sites-enabled/dipsin

# 应该看到类似的配置：
```

```nginx
upstream vxin_backend {
    server 127.0.0.1:3002;
}

server {
    listen 443 ssl http2;
    server_name dipsin.com;

    # SSL证书配置
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 前端文件
    location /vxin/ {
        alias /path/to/vxin/frontend/;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://vxin_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

#### 修复 Nginx 配置

```bash
# 1. 编辑配置文件
sudo nano /etc/nginx/conf.d/dipsin.conf

# 2. 确保包含上面的 upstream 和 proxy_pass 配置

# 3. 测试配置语法
sudo nginx -t
# 输出: nginx: configuration file test is successful

# 4. 重新加载 Nginx
sudo systemctl reload nginx

# 5. 验证
curl https://dipsin.com/api/health
```

---

### 方案 3: 环境变量配置错误

#### 症状
```
后端启动但立即崩溃
curl http://localhost:3002/health
# Connection refused

tail -50 /root/v信/backend-v2/logs/error.log
# 包含数据库连接错误或其他配置错误
```

#### 检查环境变量

```bash
# 查看 .env 文件
cat /root/v信/backend-v2/.env

# 应该包含：
DATABASE_URL=postgresql://user:pass@localhost:5432/vxin
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
NODE_ENV=production
PORT=3002
SENTRY_DSN=https://...@ingest.sentry.io/...
```

#### 验证连接

```bash
# 检查 PostgreSQL
psql -h localhost -U postgres -d vxin -c "SELECT 1"

# 检查 Redis
redis-cli ping
# 输出: PONG

# 检查后端能否读取环境变量
node -e "console.log(process.env.DATABASE_URL)"
```

---

### 方案 4: 后端进程崩溃

#### 症状
```
后端能启动但不稳定
页面加载时间长
请求失败率高
```

#### 查看日志

```bash
# 查看错误日志
tail -100 /root/v信/backend-v2/logs/error.log

# 查看完整日志
tail -100 /root/v信/backend-v2/logs/combined.log

# 实时查看
tail -f /root/v信/backend-v2/logs/error.log

# 查看系统日志（如果使用systemd）
journalctl -u vxin-backend -n 50 --no-pager
```

#### 常见错误

**错误 1: 数据库连接失败**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
解决: 确保 PostgreSQL 已启动
```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

**错误 2: Redis 连接失败**
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
解决: 确保 Redis 已启动
```bash
sudo systemctl status redis-server
sudo systemctl start redis-server
```

**错误 3: 端口已被占用**
```
Error: listen EADDRINUSE :::3002
```
解决: 找到并杀死占用端口的进程
```bash
lsof -i :3002
# 输出: node 12345 ...
kill -9 12345

# 或改用其他端口
PORT=3003 npm start
```

**错误 4: 模块未找到**
```
Error: Cannot find module 'express'
```
解决: 重新安装依赖
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## 完整检查清单

```bash
#!/bin/bash

echo "=========================================="
echo "v信后端完整诊断检查"
echo "=========================================="

# 1. 检查 Node 和 npm
echo -e "\n[1] 检查 Node.js 和 npm"
node -v
npm -v

# 2. 检查后端进程
echo -e "\n[2] 检查后端进程"
ps aux | grep -i "node\|npm start" | grep -v grep

# 3. 检查端口
echo -e "\n[3] 检查 3002 端口"
netstat -tlnp | grep 3002 || echo "Port 3002 not listening"

# 4. 测试直连
echo -e "\n[4] 测试直连后端"
curl -s http://localhost:3002/health | jq . 2>/dev/null || echo "Backend not responding"

# 5. 测试通过 Nginx
echo -e "\n[5] 测试通过 Nginx"
curl -s https://dipsin.com/api/health | jq . 2>/dev/null || echo "Nginx 502"

# 6. 检查数据库
echo -e "\n[6] 检查数据库"
psql -h localhost -U postgres -d vxin -c "SELECT 1" 2>&1 | head -5

# 7. 检查 Redis
echo -e "\n[7] 检查 Redis"
redis-cli ping

# 8. 检查日志
echo -e "\n[8] 后端错误日志（最后10行）"
tail -10 /root/v信/backend-v2/logs/error.log

echo -e "\n=========================================="
echo "诊断完成"
echo "=========================================="
```

---

## 紧急修复步骤（5分钟快速恢复）

```bash
# 1. SSH 登录服务器
ssh root@香港服务器IP

# 2. 停止旧进程
pkill -f "npm start" || true
pm2 kill || true

# 3. 进入项目目录
cd /root/v信/backend-v2

# 4. 确保依赖
npm ci  # 使用 ci 而不是 install，更稳定

# 5. 启动服务（使用 PM2）
npm install -g pm2
pm2 start "npm start" --name vxin
pm2 save
pm2 startup

# 6. 验证
sleep 3
curl http://localhost:3002/health

# 7. 测试前端访问
curl -s https://dipsin.com/api/health | head

echo "✅ 恢复完成！"
```

---

## 性能优化建议

### 1. 启用 gzip 压缩

```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript;
gzip_min_length 1000;
```

### 2. 缓存优化

```nginx
location /api/ {
    proxy_cache_valid 200 1m;
    proxy_cache_key "$scheme$request_method$host$request_uri";
    add_header X-Cache-Status $upstream_cache_status;
}
```

### 3. 连接池

```nginx
upstream vxin_backend {
    server 127.0.0.1:3002 max_fails=3 fail_timeout=30s;
    keepalive 32;
}
```

---

## 监控和告警

### 添加健康检查端点监控

```bash
# 创建监控脚本
cat > /root/v信/health-check.sh << 'SCRIPT'
#!/bin/bash

BACKEND_URL="http://localhost:3002/health"
FRONTEND_URL="https://dipsin.com/api/health"

# 检查后端
if ! curl -s $BACKEND_URL | grep -q '"ok":true'; then
    echo "Backend unhealthy! Restarting..."
    pm2 restart vxin
    # 发送告警通知
fi

# 检查前端API
if ! curl -s $FRONTEND_URL | grep -q '"ok":true'; then
    echo "Frontend API unhealthy!"
    # 发送告警通知
fi
SCRIPT

chmod +x /root/v信/health-check.sh

# 添加到 crontab（每5分钟检查一次）
(crontab -l 2>/dev/null; echo "*/5 * * * * /root/v信/health-check.sh") | crontab -
```

---

## 相关文档

- 部署指南: `DEPLOYMENT_AND_MONITORING_GUIDE.md`
- P3 完成报告: `P3完成报告_20260611.md`
- Grafana 设置: `backend-v2/GRAFANA_SETUP.md`
- Sentry 设置: `backend-v2/SENTRY_SETUP.md`

---

**最后更新**: 2026-06-11  
**快速诊断**: 第一步通常是检查后端进程是否运行  
**紧急恢复**: 按照"紧急修复步骤"可在5分钟内恢复
