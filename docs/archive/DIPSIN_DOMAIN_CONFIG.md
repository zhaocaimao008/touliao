# dipsin.com 域名配置 - 完成记录

> 配置时间：2026-06-11 | 服务器：香港 93.179.127.50

## 🌐 应用访问链接

### 主应用
- **Web 前端**：http://dipsin.com/
- **备用域名**：http://www.dipsin.com/

### API 接口
- **API 文档**：http://dipsin.com/api-docs
- **健康检查**：http://dipsin.com/health
- **性能指标**：http://dipsin.com/metrics
- **API 基址**：http://dipsin.com/api/

### 特定页面
- **登录页**：http://dipsin.com/login
- **主界面**：http://dipsin.com/home

---

## 🔧 服务器配置

| 项目 | 值 |
|------|-----|
| **服务器 IP** | 93.179.127.50 |
| **域名** | dipsin.com |
| **Web 服务器** | Nginx |
| **后端服务** | Node.js（端口 3002） |
| **协议** | HTTP（80 端口） |
| **数据库** | SQLite |
| **缓存** | Redis |

---

## ✅ Nginx 配置详情

### 配置文件
- **位置**：`/etc/nginx/sites-available/dipsin.com`
- **符号链接**：`/etc/nginx/sites-enabled/dipsin.com`

### 功能
- ✅ 监听 HTTP 80 端口
- ✅ 支持 dipsin.com 和 www.dipsin.com
- ✅ 前端 SPA 路由支持（所有未知路由 → index.html）
- ✅ API 反向代理到后端（3002 端口）
- ✅ 静态文件缓存（JS/CSS/图片等）
- ✅ 日志记录和错误处理

### 日志位置
- **访问日志**：`/var/log/nginx/dipsin.com-access.log`
- **错误日志**：`/var/log/nginx/dipsin.com-error.log`

---

## 📡 API 反向代理规则

| 路径 | 转发到 | 说明 |
|------|--------|------|
| `/api/*` | `http://localhost:3002/api/*` | 所有 API 请求 |
| `/api-docs` | `http://localhost:3002/api-docs` | Swagger API 文档 |
| `/health` | `http://localhost:3002/health` | 应用健康检查 |
| `/metrics` | `http://localhost:3002/metrics` | Prometheus 指标 |
| `/api/metrics` | `http://localhost:3002/api/metrics` | JSON 格式指标 |

---

## 🔐 HTTPS 配置（可选）

### 获取免费 SSL 证书（Let's Encrypt）

```bash
# 1. SSH 连接到服务器
ssh -i /root/v信/.deploy-config/keys/vxin-deploy root@93.179.127.50

# 2. 安装 Certbot
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx

# 3. 获取证书
sudo certbot certonly --nginx -d dipsin.com -d www.dipsin.com

# 4. 编辑 Nginx 配置
sudo nano /etc/nginx/sites-available/dipsin.com

# 5. 添加以下 SSL 配置
# ssl_certificate /etc/letsencrypt/live/dipsin.com/fullchain.pem;
# ssl_certificate_key /etc/letsencrypt/live/dipsin.com/privkey.pem;

# 6. 重启 Nginx
sudo systemctl restart nginx
```

之后可以通过 HTTPS 访问：
- https://dipsin.com/
- https://www.dipsin.com/

---

## 🔄 Nginx 常用命令

```bash
# 查看状态
sudo systemctl status nginx

# 重启 Nginx
sudo systemctl restart nginx

# 重新加载配置（不中断连接）
sudo systemctl reload nginx

# 验证配置语法
sudo nginx -t

# 查看日志
tail -f /var/log/nginx/dipsin.com-access.log
tail -f /var/log/nginx/dipsin.com-error.log

# 编辑配置
sudo nano /etc/nginx/sites-available/dipsin.com
```

---

## 📊 应用架构

```
用户浏览器
   ↓
http://dipsin.com
   ↓
Nginx 反向代理（80 端口）
   ↓
├─ 静态资源：/usr/share/nginx/html
├─ 前端应用：React/Vue SPA
└─ API 转发：/api/* → localhost:3002
   ↓
Node.js 后端服务（3002 端口）
   ↓
├─ Express 框架
├─ SQLite 数据库
└─ Redis 缓存
   ↓
返回数据
   ↓
前端渲染
   ↓
用户看到结果 ✅
```

---

## 📋 DNS 配置（如需）

如果 dipsin.com 还未指向此服务器，需要在 DNS 提供商添加 A 记录：

```
记录类型：A
主机名：dipsin.com 或 @
值：93.179.127.50
TTL：3600（或默认）
```

也可以为 www 添加 CNAME：

```
记录类型：CNAME
主机名：www
值：dipsin.com
```

---

## ✨ 部署完成状态

- ✅ Nginx 配置完成
- ✅ 前端 SPA 路由配置
- ✅ API 反向代理配置
- ✅ 域名 dipsin.com 和 www.dipsin.com 生效
- ✅ HTTP 80 端口正在监听
- ✅ 日志记录已启用
- ✅ 静态文件缓存已配置

---

## 🎯 下一步（可选）

### 生产环境推荐
1. **配置 HTTPS**（见上面 HTTPS 配置部分）
2. **配置 DNS 记录**（如需）
3. **监控应用性能**
4. **设置备份和恢复策略**

### 性能优化
- 启用 GZIP 压缩
- 配置 CDN
- 增加服务器缓存
- 优化数据库查询

---

**配置完成时间**：2026-06-11  
**配置状态**：✅ 完成  
**域名**：dipsin.com  
**服务器**：93.179.127.50

