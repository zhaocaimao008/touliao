# 投聊 部署指南（换服务器免配置）

## 一键部署（全新服务器）

新服务器只需 3 步，无需手改任何配置文件：

```bash
# 1. 准备环境（一次性）：Node 18+、nginx、pm2
npm i -g pm2

# 2. 拉代码
git clone <仓库地址> /root/touliao && cd /root/touliao

# 3. 一键部署（把域名换成你的）
./deploy/setup.sh chat.example.com
```

脚本会自动完成：
- 生成 `backend-v2/.env`，**自动产生强随机 `JWT_SECRET`**（不会用弱默认值）
- 创建 `uploads` 目录、设置自包含路径
- 安装后端依赖、构建前端（前端用相对路径，天然适配任何域名）
- 由 `nginx.conf.template` 生成本机 nginx 配置（自动填域名/端口）
- 用 pm2 启动后端 `touliao-backend`

完成后申请 HTTPS 证书：
```bash
certbot --nginx -d chat.example.com
```

## 为什么能"免配置"

| 端 | 机制 | 换服务器要做的 |
|----|------|----------------|
| **Web** | `VITE_API_BASE` 留空 → 全部相对路径，靠 nginx 转发 | 零改动，nginx 由脚本生成 |
| **桌面端** | 设置里可切换服务器（electron-store 持久化） | 用户在设置里填新域名即可，无需重装 |
| **移动端** | 登录页可切换服务器（AsyncStorage 持久化） | 用户在 App 内填新域名即可，无需重新打包 |

## 重新部署 / 更新代码

```bash
cd /root/touliao && git pull && ./deploy/setup.sh chat.example.com
```
脚本幂等：已存在的 `.env` 和密钥会被保留，不会重置用户登录态。

## 关键环境变量（脚本自动写入，一般无需手改）

| 变量 | 说明 | 默认/自动 |
|------|------|-----------|
| `PORT` | 后端端口 | 3002 |
| `DB_PATH` | SQLite 路径 | `backend-v2/wechat.db` |
| `UPLOADS_ROOT` | 上传文件目录 | `backend-v2/uploads` |
| `JWT_SECRET` | 登录令牌密钥 | 自动随机生成 |
| `CORS_ORIGINS` | 额外允许的跨域来源 | 自动填入你的域名 |
| `REDIS_URL` | 留空则自动降级内存模式 | 可选 |
