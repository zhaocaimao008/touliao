# v信 上线清单 (LAUNCH_CHECKLIST)

> RC 生产验收日期：2026-06-20 · 目标域名：https://dipsin.com
> 验收结论：**PASS（有条件）** — 无 P0；核心链路、1000 并发、主要安全面全部通过。
> 上线前必须先完成下方「必须修复项」。

---

## 0. 验收结果速览

| 部分 | 结果 |
|---|---|
| 一、HTTPS 全链路（账号/好友/单聊/群聊/朋友圈/文件/Cookie/Socket/CDN） | ✅ PASS |
| 二、推送：Web Push + 应用内通知 | ✅ 满足上线（Web 后台 + 桌面原生 + 各端前台实时）；FCM/APNS ⏸️ 推迟（无账户，非阻断） |
| 三、Windows：窗口操作×50 + 切换100次（白屏0/ErrorBoundary0/崩溃0） | ✅ PASS |
| 四、1000 真实在线（1000/1000 连接，0丢失0重复，p99≈198ms） | ✅ PASS |
| 五、安全：JWT/SQLi/越权/路径穿越/可执行上传 | ✅ PASS；上传内容类型欺骗 ⚠️ P2（prod 未部署修复） |

关键性能数据（生产实测）：
- 消息延迟 空载 p99≈18ms（本地）/ 生产 RTT≈190ms；**1000 连接下 p50/p95/p99 = 189/193/198ms（无劣化）**
- 1000 Socket：1000/1000 成功，0 失败；后端稳定 155MB / 0.5% CPU；nginx worker_connections=8192
- 0 消息丢失、0 重复（多轮验证）

---

## 1. 上线前必须修复项（GATE）

- [x] **【P2 安全】上传内容类型校验修复** — `80b96b3` 已部署生产并验证：伪装 PNG → 400 拒绝；真实 PNG 正常。✅ 2026-06-20 已关闭。
- [x] **【P1 媒体·后端】`/uploads` 兜底鉴权** — `80b96b3` 已部署生产并验证：`?token=`/Bearer 下载成功且完整、无 token 仍 401。✅
- [x] **【P1 媒体·前端】** `mediaUrl` 已在 Electron/Capacitor 下为 `/uploads` 资源追加 `?token=`（commit `256a60d`），三端已重新构建发布。Electron 实测：带 token 图片加载成功、无 token 401。✅ 桌面/移动媒体不再依赖跨域 Cookie。建议仍在正式安装包真机抽验一次。
- [x] **【文档/DNS】** 已确认代码无任何对 `config/api/ws/cdn.dipsin.com` 的硬编码（仅一处注释，已修正），全部走 `dipsin.com`。如需子域名拆分，须在 DNS 服务商添加记录（我无注册商权限）。

> 回滚后端文件备份：`meta-cats:/root/v信/backend-v2/src/{utils/upload.js,app.js}` → `*.bak-20260620_144340`；`{utils/upload.js,modules/messages/messages.routes.js}` → `*.bak2/.bak-20260620_150923`；nginx → `nginx.conf.bak-20260620_151212`。

## 1b. 本轮额外完成 / 修复（2026-06-20）

- [x] **【新功能】大文件分片 / 断点续传** — 后端 `chunk` 模块（init/chunk/status/finish，断点以 user+conv+hash 复用，魔数+sha256 校验，上限 200MB）+ 前端 `uploadChunked`（>8MB 走分片、错误自动从服务端 offset 续传）。**生产端到端实测**：6MB 文件中断于 4MB → 续传 → finish → md5 完整。三端已发布。
- [x] **【P1 修复·基础设施】nginx `client_max_body_size`** — 线上配置缺失该指令（默认 1MB），导致**所有 >1MB 上传静默 413**。已在 `meta-cats` 的 `nginx.conf` http 段加入 `55m` 并 reload，实测 2MB/6MB 上传通过。这同时修复了普通大图/文件上传。

## 1c. 推送结论（已定，不阻断上线）

**结论：以「Web Push + 应用内实时通知」上线，已满足需求。**
- ✅ **Web Push**：VAPID 已配置（`enabled=true`），浏览器后台/关页可收通知，无需任何第三方账户。
- ✅ **桌面（Electron）**：系统原生通知（IPC 已接），常驻托盘即可收消息。
- ✅ **各端前台**：socket 实时到达 + 本地通知。
- 🟢 **FCM（Android 后台推送）— 服务端+客户端均已就绪，待真机验证**：
  - ✅ 服务端：`FIREBASE_*` 已配置（prod `.env`），`[Push] Firebase Admin 初始化成功`，`fcm.enabled=true`（项目 `vxin-a1230`）。
  - ✅ 客户端：`android/app/google-services.json` 已放置，`usePushNotification` 已加原生 FCM 注册+令牌上报+点击跳转；新 APK 已含 Firebase 库并签名发布（`vxin-android-latest.apk`）。
  - ⬜ **待真机验证**（我无法用无头环境模拟真实 FCM 令牌）：真机装新 APK → 登录授权通知 → `devices` 计数 +1 → 另一账号发消息 → 杀进程仍收推送 + 点击进会话。
  - 📌 `google-services.json` 位于 gitignore 的 `android/` 目录，请单独备份（重新 `cap add android` 会丢）。
  - ℹ️ 安全备注:服务账号私钥(`private_key_id: 5aea7ea7…`)曾在对话明文出现;经确认**用户接受此风险,暂不轮换**。如日后需要,可在 Firebase 重新生成并删除旧密钥。
- ⏸️ **APNS（iOS 后台推送）— 推迟**：需 Apple 开发者账户（$99/年）+ macOS（iOS 打包本身也需 Mac）。属后续独立事项。

## 2. 上线建议项（非阻断）

- [ ] （推迟，非阻断）移动端**后台**推送 FCM/APNS：见 §1c。当前以 Web Push + 应用内通知上线，已满足需求。
- [ ] 断点续传未实现（聊天文件为单次 multipart，上限 50MB）。如需大文件/100MB，需引入分片上传。
- [ ] iOS 工程未验收（需 macOS+Xcode）；WebRTC 通话、原生托盘/开机启动/截图/拖拽/粘贴 未在本环境实测（需真机）。

---

## 3. 上线顺序

1. **备份**：`wechat.db`、当前 `web/dist/index.html`、当前 backend 源码（git tag）、当前 downloads 安装包。
2. **后端**：rsync `upload.js`+`app.js`(80b96b3) → meta-cats:`/root/v信/backend-v2/` → `pm2 restart vxin-server-v2` → 验证 `/health` + 伪装PNG返回400。
3. **前端 Web**：确认 meta-cats:`/root/v信/web/dist` 为最新构建（含气泡/AutoSizer/CDN 引导修复）→ `nginx -t && systemctl reload nginx`。
4. **安装包**：确认 `/var/www/downloads` 的 Windows `.exe` / Android `.apk` 为最新签名版（前端机 md5 与本地一致）。
5. **灰度**：内部账号真机验证（Electron/Android 媒体加载、登录、收发）→ 小范围用户 → 全量。
6. **配置**：如需切服务器，改 `vxin-config/config.json` → push → `purge.jsdelivr.net`。

## 4. 回滚方案

| 组件 | 回滚动作 |
|---|---|
| 后端 | `git checkout <上个tag> && pm2 restart vxin-server-v2`；数据异常则用步骤1的 `wechat.db` 备份恢复 |
| 前端 Web | 用备份的 `index.html` 覆盖 `web/dist/` → `nginx reload`（单文件，秒级回滚） |
| 安装包 | downloads 保留上一版本文件；将 `*-latest-*` 指回旧包 |
| 远程配置 | `vxin-config` `git revert` config.json + jsDelivr purge |

回滚判定：5xx>2% 持续 5 分钟 / 登录或发消息成功率<95% / 大面积白屏上报 → 立即回滚。

## 5. 监控项

- **后端**：CPU、内存（`pm2 monit`）、`:3002` ESTABLISHED 连接数、`/health`
- **Socket**：连接成功率（`prodMetrics.recordConnResult`）、消息成功率（`recordMsg`）、消息延迟
- **错误**：5xx 率、ErrorBoundary 触发、白屏 `sendBeacon` 上报、Socket 断连率
- **业务**：注册/登录成功率、消息 p50/p95/p99、Web Push 到达率
- **资源**：uploads 磁盘增长、DB 体积、nginx 连接数（上限 8192）、证书有效期（当前至 2026-09-03）
- **告警阈值**：CPU>80% / 内存>80% / 连接>6000 / p99>1s / 5xx>1% / 证书<14 天到期

---

## 6. 已确认健康项（无需动作）

- TLS 证书有效（CN=dipsin.com，至 2026-09-03）、HTTP/2、HTTPS 全通
- Cookie 鉴权（httpOnly + 跨域 SameSite=None）正常；JWT 防伪造（alg=none/弱密钥均拒绝）
- 越权读写 403、SQL 注入无效、路径穿越拒绝、可执行上传拒绝
- 1000 并发稳定、0 丢失 0 重复、虚拟列表大列表（1000+ 消息）DOM 受控无崩溃
- 远程配置中心（dipsin.com/config.json + jsDelivr 多地址兜底）可换服务器免重编译
