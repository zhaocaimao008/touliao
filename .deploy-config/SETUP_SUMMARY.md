# V信后端自动部署配置总结

## ✅ 已完成

- ✅ SSH 部署密钥已生成
- ✅ GitHub Actions 工作流已配置
- ✅ 服务器配置脚本已生成

## 📋 后续步骤（4 个）

### 第 1 步：在服务器上运行初始配置

```bash
# 在香港服务器上执行
bash install-pubkey.sh
bash server-setup.sh
```

**或者手动执行：**

```bash
ssh root@<你的服务器IP>

# 创建必要目录
mkdir -p ~/.ssh /root/v信 /var/lib/vxin/{logs,uploads,db}

# 添加公钥
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJKNcQKmUmBBI8cHVb7FQDC//ILd/3dRnHTgo7+QVqgs vxin-backend-deploy-1781151288" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 第 2 步：在 GitHub 添加 Secrets

进入：**GitHub 仓库 → Settings → Secrets and variables → Actions**

添加 3 个 Secrets（参考 `github-secrets.txt`）：

1. `DEPLOY_SSH_KEY` - 私钥内容
2. `DEPLOY_SERVER_HOST` - 服务器 IP
3. `DEPLOY_USER` - 登录用户（通常 `root`）

### 第 3 步：推送代码到 GitHub

```bash
git push origin main
```

### 第 4 步：验证自动部署

1. 进入 GitHub 仓库 → Actions
2. 查看工作流运行状态
3. 等待 ✅ 测试 + ✅ 部署 通过

## 🔑 密钥信息

| 项目 | 值 |
|------|-----|
| 密钥类型 | ED25519 |
| 密钥指纹 | SHA256:yDNnTp7CZgAnAAVG83MNkZsb08zzykOyEC/4cMIjDpQ |
| 私钥位置 | `.deploy-config/keys/vxin-deploy` |
| 公钥位置 | `.deploy-config/keys/vxin-deploy.pub` |

## 📁 生成的文件

- `github-secrets.txt` - GitHub Secrets 配置说明
- `server-setup.sh` - 服务器初始化脚本
- `install-pubkey.sh` - 公钥安装脚本
- `SETUP_SUMMARY.md` - 本文件

## 🚀 工作流

```
git push origin main
         ↓
GitHub Actions 自动触发
         ↓
测试通过 → 自动部署到服务器
         ↓
应用启动 + 健康检查
         ↓
✅ 完成！
```

## ⚠️ 注意

- 私钥保存在 `.deploy-config/keys/` 中（不要提交到 Git）
- 公钥需要添加到服务器的 `~/.ssh/authorized_keys`
- GitHub Secrets 中的敏感信息是加密的

## 🆘 故障排查

**无法连接到服务器**
```bash
# 检查 SSH
ssh -i .deploy-config/keys/vxin-deploy root@<服务器IP>

# 检查公钥是否添加
ssh root@<服务器IP> cat ~/.ssh/authorized_keys
```

**部署失败**
- 查看 GitHub Actions 的详细日志
- 查看服务器上的应用日志：`tail -f /tmp/vxin-backend.log`

