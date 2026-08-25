# 投聊交付包清单(Delivery Package)

本文件是投聊(touliao)源码销售的**交付物清单**与**验收指南**。交付时按此清单逐项核对。

## 一、交付物清单

| # | 交付物 | 位置 | 说明 |
|---|--------|------|------|
| 1 | 完整源码 | 本仓库全部目录 | backend-v2 / web / admin / android / ios / desktop-electron / landing |
| 2 | 后端服务 | `backend-v2/` | Express + SQLite + Socket.io,单服务器可跑 |
| 3 | Web 端 | `web/` | React + Vite,构建产物部署 nginx |
| 4 | 管理后台 | `admin/` | 独立 HTML 后台(用户/消息/群组/统计) |
| 5 | Android 安装包 | `android/app/build/outputs/apk/release/app-release.apk` | 签名版(需按客户品牌重新签名) |
| 6 | iOS 工程 | `ios/` | XcodeGen,CI 已通(需客户开发者账号重新签名) |
| 7 | 桌面端 | `desktop-electron/` | Electron 打包 |
| 8 | 落地页 | `landing/` | 官网/下载页 |
| 9 | 部署脚本 | `deploy/setup-new-server.sh` | 一键部署新服务器 |
| 10 | 品牌设计资产 | `design-assets/` | 图标/启动图/横幅/吉祥物全套 |

## 二、客户私有化部署步骤(约 30 分钟)

### 1. 准备服务器

- 1 台 Linux 服务器(建议 2C4G+,Ubuntu 22.04)
- 域名 + SSL 证书(可 certbot 自动签)
- Node.js 20+、PM2、nginx

### 2. 一键部署

```bash
# 上传源码到服务器后
bash deploy/setup-new-server.sh
# 脚本自动:装依赖 → 生成 .env(强随机密钥)→ 初始化数据库 → pm2 启动 → nginx 配置
```

### 3. 品牌替换(白标)

| 改什么 | 改哪里 |
|--------|--------|
| 应用名 | web/index.html title、android strings.xml、ios project.yml、desktop package.json |
| Logo/图标 | design-assets/ 全套,替换 android mipmap、ios AppIcon、web public/icons |
| 域名/API 地址 | 部署 `config.json`(web 根目录),**无需重编译** |
| 管理后台账号 | 服务器 `.env` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` |

### 4. 验收清单

- [ ] `https://<域名>/` 打开登录页
- [ ] 注册/登录正常(邀请码 `123456` 或后台关闭邀请校验)
- [ ] 单聊/群聊/文件/图片/语音消息收发正常
- [ ] 音视频通话接通(TURN 已配)
- [ ] 管理后台登录(IP 白名单按需设置 `ADMIN_IP_WHITELIST`)
- [ ] 推送:Android 个推 + iOS APNs(需客户 Firebase/个推账号替换)

## 三、运营注意事项

1. **资质**:国内对 C 端运营 IM 需 ICP 许可证 + 增值电信业务许可;建议以私有化/企业内网场景交付,由客户自担资质责任。
2. **语音通话**:VoIP 国内强管制,海外部署无此限制。
3. **推送密钥**:Android 个推(GeTui)、iOS APNs/Firebase 需客户自行注册账号并替换密钥,交付时提供替换指引。

## 四、售后支持范围(默认)

- 交付后 7 天内部署问题远程支持
- 源码级答疑(不包含新功能开发)
- 增值服务可另行报价:定制开发 / 品牌全案 / 运维托管 / 培训
