# V信应用 - 部署链接速查卡

> 生成时间：2026-06-11 | 部署服务器：香港 93.179.127.50

## 🌐 前端应用

### Web 前端
- **主页**：http://93.179.127.50/
- **登录**：http://93.179.127.50/login
- **主界面**：http://93.179.127.50/home

### 移动端
- **位置**：/root/v信/mobile
- **状态**：源码已部署，需要通过 Expo 或应用商店访问

---

## 🔌 后端 API

### API 基址
- **URL**：http://93.179.127.50:3002
- **健康检查**：http://93.179.127.50:3002/health
- **API 文档**：http://93.179.127.50:3002/api-docs
- **性能指标**：http://93.179.127.50:3002/metrics

### API 端点示例
```bash
# 健康检查
curl http://93.179.127.50:3002/health

# 查看实时指标
curl http://93.179.127.50:3002/api/metrics

# Prometheus 指标
curl http://93.179.127.50:3002/metrics
```

---

## 🔧 服务器信息

| 项目 | 值 |
|------|-----|
| IP 地址 | 93.179.127.50 |
| 位置 | 香港 |
| SSH 用户 | root |
| Web 服务器 | Nginx（端口 80） |
| API 服务器 | Node.js（端口 3002） |
| 数据库 | SQLite |
| 缓存 | Redis |

---

## 📡 网络架构

```
浏览器 → Nginx(80) → Web 前端
                     ↓
                  API 调用
                     ↓
         Node.js API(3002)
                     ↓
            SQLite + Redis
                     ↓
              返回响应 → 浏览器
```

---

## 🔐 安全提醒

- ⚠️ 当前使用 HTTP（未加密），仅用于开发
- 🔒 生产环境需要配置 HTTPS（SSL/TLS）
- 🔑 所有 API（除 /health）都需要 JWT 认证
- ✓ CORS 已在后端配置

---

## 📱 访问方式

### 从浏览器访问前端
1. 打开浏览器
2. 输入：http://93.179.127.50
3. 或输入：http://93.179.127.50/login 直接登录

### 从代码调用 API
```javascript
// 前端调用后端 API
const response = await fetch('http://93.179.127.50:3002/api/users', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  }
});
```

---

## 🛠️ 常见操作

### SSH 连接服务器
```bash
ssh -i /root/v信/.deploy-config/keys/vxin-deploy root@93.179.127.50
```

### 查看后端日志
```bash
tail -f /tmp/vxin-backend.log
```

### 查看前端文件
```bash
ls -la /usr/share/nginx/html/
```

### 重启服务
```bash
# 重启后端
pm2 restart vxin-backend

# 重启 Nginx
sudo systemctl restart nginx
```

---

## 📊 监控和维护

### 查看应用状态
```bash
ps aux | grep -E "npm|nginx"
```

### 查看开放的端口
```bash
netstat -tlnp | grep LISTEN
```

### 查看日志
```bash
# 后端日志
tail -100 /tmp/vxin-backend.log

# Nginx 日志
tail -100 /var/log/nginx/access.log
tail -100 /var/log/nginx/error.log
```

---

## 🔗 快速链接汇总

| 用途 | 链接 | 说明 |
|------|------|------|
| **Web 前端** | http://93.179.127.50/ | 用户界面 |
| **API 基址** | http://93.179.127.50:3002 | 后端 REST API |
| **API 文档** | http://93.179.127.50:3002/api-docs | Swagger API 文档 |
| **健康检查** | http://93.179.127.50:3002/health | 应用状态检查 |
| **性能指标** | http://93.179.127.50:3002/metrics | Prometheus 指标 |

---

## ✅ 部署完成确认

- ✅ 前端已部署（Nginx）
- ✅ 后端已部署（Node.js）
- ✅ 自动 CI/CD 已配置
- ✅ 监控和日志已就绪
- ✅ 所有服务正常运行

---

**最后更新**：2026-06-11  
**部署状态**：✅ 就绪  
**维护者**：Hermes Auto-Deploy

