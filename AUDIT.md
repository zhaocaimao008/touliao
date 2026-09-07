# 投聊 · 性能与逻辑体检 AUDIT（2026-09-07）

## 🔐 凭据保险库（已建, 2026-09-07, 换服务器免重办推送凭证）
- 见 `docs/secrets-vault-runbook.md`：GPG-AES256 加密包（/root/touliao-secrets-vault/），口令已交付用户密码管理器；`.env`+VAPID 已入库，APNs p8/个推三件套拿到后放 `extra/` 跑 `backup-vault.sh` 即入库
- 旧机教训固化：凭据必须可离线恢复，禁止只存在于单台服务器 .env


范围：backend-v2（PM2 `touliao-backend`:3003，新加坡 13.212.117.22）+ web 前端 + 运行环境。只读检查，**未改任何代码**。本文件即待办清单，按优先级处理；处置后在本文件打勾并删除条目。

## 体检基线（健康项，无需处理）
- 服务：`/health` → `{ok:true, db:ok}`；PM2 0 重启；内存 183MB、CPU 1.3%
- 主机：load 0.01、内存可用 13GB、磁盘 9%
- 日志：errlog 10,532/10,553 行为 **9-06 前遗留的 Redis ECONNREFUSED 刷屏**（主机 Redis 装好后已停写，errlog 自 9-06 17:03 冻结）；当前 out.log 无错误，API 耗时 1–5ms
- Redis：db5=4 键（缓存/令牌在用，连接正常）
- 数据量（极小，无性能压力）：users=3、conversations=4、messages=18、61 个索引、FTS5 已建（messages_fts_*）
- 页面冷加载：DCL 132ms / load 133ms / 首屏 742KB 传输（SG 直连，优秀）
- SQLite 单机架构对当前量级完全胜任

## 🔴 P1 推送体系在生产全未配置（功能缺失，非崩溃）
- **Web Push：✅ 已恢复（2026-09-07）**：backend-v2/.env 生成并写入 `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY` → `pm2 restart touliao-backend --update-env` → `/api/notifications/vapid-public-key` 200、前端引导条恢复显示、SW 注册成功、503 清零。密钥仅存 .env（未入库）。
现象：
- `/api/notifications/vapid-public-key` 每次页面加载都返回 **503**（out.log 每会话 2~6 条 warn）
- 移动端新消息推送、iOS 直连 APNs、Android 个推、Web Push **全部不生效**

证据：
- `backend-v2/.env` 仅有：PORT NODE_ENV APP_URL JWT_SECRET ADMIN_USERNAME ADMIN_PASSWORD ADMIN_JWT_SECRET CALL_REQUIRE_ID CALL_RECONNECT_GRACE_MS
- `/proc/<pid>/environ` 同样无推送凭据（非 PM2 env 注入）
- 代码需要的键全部缺失：`GETUI_APP_ID/APP_KEY/MASTER_SECRET`（getuiPush.js:15-17）、`FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`（push.js:42）、`APNS_P8/APNS_KEY_ID/APNS_TEAM_ID`（push.js:386）、`VAPID_PUBLIC/PRIVATE_KEY`（config vapid）
- `device_tokens` 表 0 行；服务端各 provider 均走“未配置即跳过/503”优雅路径，故无崩溃、无异常日志
- 迁移背景：凭据随 9-06 死掉的日服旧机丢失（旧 .env 未随迁），新机从未补齐（此前记忆里“.env 含 GETUI/APNs key”指向的是旧服务器状态，本机实测为无）

影响：
- 任何用户**收不到任何推送**：Android 无个推、iOS 无 APNs、Web 无 Push
- 连带逻辑缺陷（web 前端）：VAPID 拉取失败被 `setup()` 静默吞掉 → 引导条照常出现；用户点「开启」→ 系统权限已授予、引导条消失，但服务端**从未建订阅**——权限浪费且后续无法再申请，表现为“已开通实则收不到”

建议（需拍板，二选一或都做）：
1. 启用推送（推荐）：重新生成/找回凭据——
   - APNs：Apple 后台重新签发 p8（或找旧机备份），填 `APNS_P8/APNS_KEY_ID/APNS_TEAM_ID`（topic 固定 `com.touliao.app`，push.js:372）
   - 个推：GeTui 开放平台重新拿 `GETUI_APP_ID/APP_KEY/MASTER_SECRET`（Android APK 内三件套需同步一致）
   - Web/VAPID：`npx web-push generate-vapid-keys` 填 `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY`（一对即可，跨端共用）
   - FCM 可选（有 ios_apns 直连后 iOS 不依赖它）
   - 改完 `pm2 restart touliao-backend --update-env`，然后 `curl /api/notifications/vapid-public-key` 应 200、`push-diag` 端点复查
2. 若不做 Web Push：前端 `usePushNotification.js` setup 的 503 分支要**显式置 unsupported**（目前 catch 吞掉导致引导条假“可开启”），见 P2。

## 🟡 P2 Web 推送引导条假可用 —— ✅ 已修（2026-09-07, web/src/hooks/usePushNotification.js）
- 修复：setup() 拉 VAPID 失败（503/404/无公钥）或异常时置 `permission='unsupported'` → `PushPermissionGuide` 不再出现；不再把失败静默吞掉造成“已授权但永不建订阅"。服务端补齐 VAPID 后下次进入自动恢复引导。
- 注：本修复**不是**启用 Web Push；VAPID 配上后该代码路径自然进入正常订阅。

## 🟡 P3 管理后台无 IP 白名单
- 启动日志自警：`ADMIN_IP_WHITELIST 未配置，后台可从任意 IP 登录`；`ADMIN_USERNAME/PASSWORD/JWT_SECRET` 已配但白名单空
- 建议：`.env` 加 `ADMIN_IP_WHITELIST=13.212.117.22,8.8.8.8`（按实际运维出口 IP），改后重启验证

## 🟢 P3 SQLite WAL 体积与数据规模不匹配
- `wechat.db` 主文件 1.5MB + **WAL 8.3MB**（9-06 17:18 后主库无 checkpoint 迹象，WAL 持续更新到 02:23）
- 数据仅 18 条消息却有 8MB WAL → 有写放大或 checkpoint 被长连接/忙锁拖住；当前无影响，但长期不收敛会无限增长并拖慢启动
- 建议（运维，非代码）：定期 `sqlite3 wechat.db "PRAGMA wal_checkpoint(PASSIVE);"`（可放 cron），或服务空闲时 `.backup` 一次压缩；观察是否回落

## 📋 顺带观察（当前无需处理，记录备查）
- 前端首屏 742KB：脚本 206KB(gz) + CSS 193KB + 字体等 344KB；pdf/xlsx/docx 重 chunk（456K/420K/172K）为动态导入，仅打开对应文件时加载 —— 结构合理，暂不动
- errlog 遗留 10.5K 行历史噪声（9-06 前 redis 未装时）：`pm2 flush touliao-backend` 一次即可清零，非问题
- 后端 requestId/时长日志齐全（1–5ms），无慢查询迹象；数据库连接与 FTS 无异常
- GETUI/APNs 恢复后，Android/iOS 需重发一次包才能保证 CID 上报路径完整自检（device_tokens 表从 0 开始累积）
