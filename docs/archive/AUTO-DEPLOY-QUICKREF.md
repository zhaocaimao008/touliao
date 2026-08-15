# V信后端自动部署 - 快速参考卡

> 生成时间：2026-06-11 | 作者：Hermes Auto-Config

## ✅ 部署配置状态

| 项目 | 状态 | 详情 |
|------|------|------|
| **GitHub Actions** | ✅ 完成 | `.github/workflows/deploy.yml` |
| **SSH 密钥对** | ✅ 完成 | `/root/v信/.deploy-config/keys/` |
| **GitHub Secrets** | ✅ 完成 | DEPLOY_SSH_KEY, DEPLOY_SERVER_HOST, DEPLOY_USER |
| **服务器配置** | ✅ 完成 | 93.179.127.50 - Node.js v20, npm v10 |
| **代码仓库** | ✅ 完成 | 已克隆到 /root/v信/backend-v2 |

---

## 🚀 现在可以做什么

### 最常用的命令

```bash
# 推送代码触发自动部署
cd /root/v信
git add .
git commit -m "your message"
git push origin main

# 查看部署日志
# GitHub → Actions → 最新工作流

# 访问部署的应用
curl http://93.179.127.50:3002/health
```

### SSH 访问（如需调试）

```bash
# 连接到服务器
ssh -i /root/v信/.deploy-config/keys/vxin-deploy root@93.179.127.50

# 查看应用日志
tail -f /tmp/vxin-backend.log

# 查看应用状态
ps aux | grep "npm start"
```

---

## 📊 工作流流程

```
git push origin main
        ↓
GitHub Actions 自动触发
        ↓
[测试] npm test
        ↓
[如果通过] ↓
        ↓
[部署] SSH → 拉取代码 → 安装依赖 → 启动应用
        ↓
[验证] 健康检查 /health
        ↓
✅ 完成！
```

---

## 🔧 服务器信息

| 项目 | 值 |
|------|-----|
| IP 地址 | 93.179.127.50 |
| SSH 用户 | root |
| 应用目录 | /root/v信/backend-v2 |
| 应用端口 | 3002 |
| 日志位置 | /tmp/vxin-backend.log |

---

## 🎯 常见操作

### 查看部署历史
```
GitHub → Actions → 选择工作流 → 查看运行历史
```

### 手动触发部署
```
GitHub → Actions → 自动部署 V信后端 → Run workflow
```

### 禁用自动部署
```
GitHub → Actions → 自动部署 V信后端 → ... → Disable workflow
```

### 查看 GitHub Secrets
```
GitHub → Settings → Secrets and variables → Actions
```

---

## ⚡ 故障排查

### 部署失败

**查看 GitHub Actions 日志：**
1. GitHub → Actions
2. 点击红色 ❌ 的工作流
3. 查看失败步骤的详细日志

**查看服务器日志：**
```bash
ssh -i ~/.ssh/vxin-deploy root@93.179.127.50
tail -100 /tmp/vxin-backend.log
```

### SSH 连接失败

```bash
# 测试连接
ssh -v -i /root/v信/.deploy-config/keys/vxin-deploy root@93.179.127.50

# 检查公钥是否安装
ssh root@93.179.127.50 "cat ~/.ssh/authorized_keys | grep AAAAC3NzaC1lZDI1NTE5"
```

### 应用启动失败

```bash
# SSH 连接到服务器
ssh -i /root/v信/.deploy-config/keys/vxin-deploy root@93.179.127.50

# 进入应用目录
cd /root/v信/backend-v2

# 检查依赖
npm list | head -20

# 手动启动应用
NODE_ENV=production PORT=3002 npm start
```

---

## 📁 重要文件位置

```
/root/v信/
├── .github/workflows/deploy.yml      ← GitHub Actions 工作流
├── .deploy-config/
│   ├── keys/vxin-deploy              ← 私钥（GitHub Secret）
│   ├── keys/vxin-deploy.pub          ← 公钥（已在服务器）
│   └── SETUP_SUMMARY.md              ← 设置总结
├── .github/DEPLOYMENT_SETUP.md       ← 详细配置文档
├── .github/QUICK_START.md            ← 快速指南
└── DEPLOYMENT_CHECKLIST.md           ← 部署检查清单
```

---

## 🔐 安全说明

✓ 私钥仅存储在 GitHub Secrets 中（加密）  
✓ 公钥仅在服务器上（不含私钥）  
✓ `.deploy-config/` 已添加到 `.gitignore`  
✓ SSH 使用密钥认证（无需密码）  
✓ Token 已销毁（不会保存）

---

## 📞 联系和支持

- GitHub 仓库：https://github.com/zhaocaimao008/vxin-1.0
- Actions 页面：https://github.com/zhaocaimao008/vxin-1.0/actions
- Secrets 设置：https://github.com/zhaocaimao008/vxin-1.0/settings/secrets/actions

---

**最后更新**：2026-06-11  
**自动配置工具**：Hermes  
**部署状态**：✅ 准备就绪

