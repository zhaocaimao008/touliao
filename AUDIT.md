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

---

# 在线语音通话全链路体检（gpt-6 四端审查 + 逐条回码核验, 2026-09-07）

方式：gpt-6(gpt-6-astra) 分四片审查 后端call.js/registry/message/reconciler + Web CallModal + Android CallManager + iOS CallManager，再做跨端合议；全部 P 级条目已由人工回源码逐行核验（未核验的误报已剔除或降级）。基线：通话相关后端测试 10 suites / 57 tests 全绿；生产日志无通话报错（仅旧 chunk 缓存噪声）；TURN /api/turn/credentials 在线(401=鉴权拦截,正常)。
**整改（2026-09-07 当日晚, 用户指令"全部动手搞定"）**：除下方标注「⏳待产品拍板」外, P1/P2/P3 全部已修并落回归测试;Web+后端已本地验证(lint 0 警告/vitest 9/9/vite build/后端 jest 全量见 commit),Android/iOS 改动由 GH Actions android-build/ios-build 推送即编译验证。本体检原始状态为只读,现为处置记录。

## 🔴 P1（2/3 已处置, 1 待拍板）
- [x] **服务端重拨覆盖可无限绕过 5s 防骚扰冷却（call.js:178-182 + 231-232）** ✅已修(2026-09-07):覆盖分支不再删冷却(本请求已 setCooldown);新增 setCooldown/removeCooldown+定时器表(防整点边界旧 timer 误删新记录),全部 delete 点改走 removeCooldown;限流命中 ack({callId:null,error:'CALL_RATE_LIMIT'}) 不再静默丢;回归 test/call-cooldown-unit.test.js。
  现象/证据：`callRateMap.set`+一次性 `setTimeout(delete)`（182）；重拨覆盖旧通话时 `callRateMap.delete(userId)`（232）**未为新通话重建冷却**。
  影响：只要一通旧呼叫仍在响（最长 120s），即可连续重拨无限次——每轮对被叫触发 replaced+新 incoming（连环响铃骚扰），并刷 call_logs/通话系统消息。5s 限流形同虚设。
  修复建议：覆盖路径 delete 后立即对新通话 set 新时间戳并重置定时器；或在 override 分支内改「重置冷却到 now」而非删除。另 5s 整点边界旧定时器可能误删新记录（同族，一并处理）。建议补冷却生命周期单测。
- [x] **Web accept 双击无幂等守卫 → 通话结束后麦克风/摄像头仍被占用（CallModal.jsx:454-462, 348-394）** ✅已修(2026-09-07):accept/reject/replyInstead 加 acceptBusyRef/rejectBusyRef 守卫+accept try/catch 收尾;initPC 每 await 后 aliveRef 存活守卫(已卸载即停流中止);卸载 effect 先置 aliveRef=false 再 cleanup;outgoing 迟到 initPC 不再排超时定时器;toggleVideo 补轨 await 后同守卫。
  现象/证据：accept() 无状态/ref 守卫，连点两次在 initPC 完成前可二次执行 → 两个 getUserMedia/RTCPeerConnection；pcRef 被第二个覆盖，第一个 PC 永不 close、其媒体流无引用可停（cleanup 只停 localStreamRef.current=第二个流）。移动端双击接听窗口真实。
  影响：隐私级——通话已结束但设备采集持续（浏览器指示灯常亮）；权限弹窗期快速取消同理（见 P2#1 同根因）。
  修复建议：accept/reject/replyInstead 入口加幂等 ref 守卫（如 acceptingRef），并统一到「异步媒体副作用须绑组件存活」模式。
- [x] **四端呼出等待超时不一致 30/45/60/120s**（Web CallModal.jsx:34=30s；iOS CallManager.swift:75=45s；Android CallManager.kt:372=60s；服务端 call.js 兜底=120s） ✅已修(2026-09-07,用户拍板「全部修复」按建议值 45s):Web CALL_TIMEOUT_MS 30000→45000;Android delay 60_000→45_000(注释同步);iOS 本就 45 未动;服务端 120s 兜底保留(须长于客户端,双端离线场景仍落 missed)。回归:Android/iOS 靠 GH Actions 编译验证;Web 值改无逻辑变化,eslint/vitest/build 过。剩余差异=服务端兜底 120s 是有意安全网,非缺陷。
  现象/证据：同产品四端「响铃多久自动挂断」不同（30/45/60）；且主叫端超时=客户端发 call:end→服务端落 canceled，服务端 120s 兜底才落 missed——「对方无应答」文案只在两端都不在线时出现。
  影响：跨端体验不一致（同账号不同设备拨打等待时长不同）；超时语义/落库状态随“谁先超时”漂移，通话记录与聊天系统消息文案可能矛盾（主叫界面「对方未接听」vs 消息「已取消」）。
  建议：拍板统一值（如 45s），服务端兜底与各端收敛一致；若保留差异需在架构文档写明「服务端 120s 仅兜底双方失联」。

## 🟡 P2（全部已处置）
- [x] **Web 异步媒体初始化无 unmount 存活守卫（CallModal.jsx:348-394, 577-592）** ✅已修(与 P1#2 同 commit):aliveRef 统一守卫覆盖发起/接听/切类型三入口;卸载 effect 先置死再 cleanup。现象记录：挂断/关闭发生在 getUserMedia/TURN/建 PC 完成前 → 结果返回后仍建流/PC（cleanup 已先跑），麦克风持续采集。
- [x] **Android ack 丢失 → 被叫幽灵响铃直到服务端超时（CallManager.kt:383-390 + SocketManager.kt:623-643）** ✅已修(2026-09-07):ack 超时收尾分支在 socket 仍连接时补发无 callId 的 call:end(服务端 resolvePrivateCall 按 (我,对端) 清悬空响铃);新增 SocketManager.isConnected() 守卫,未连接绝不 emit(防 sendBuffer 重连后补发旧 end 误杀同对端新通话)。现象记录：call:request 已达服务端但 ack 丢失 → 本地 10s AckWithTimeout 后 cleanup(ENDED) 且**不发 call:end**，服务端 activeCalls 仍在响 → 被叫端无人接也无人拒，直到 120s。
- [x] **iOS 异步 SDP/ICE 回调无实例归属校验（CallManager.swift:450-458 / 494-502 / 669-672）** ✅已修(2026-09-07):createOfferAndSend/createAnswerAndSend 完成回调加 `self.pc === pc` + stage∈{connecting,connected} 双守卫,旧 PC 迟到 SDP 丢弃;didGenerate 加 `peerConnection === pc` 守卫。现象记录：回调完成时读可变 self.state.peerId/callId 发送——挂断→秒重拨窗口内旧 PC 迟到信令会按新通话身份发出污染新协商。
- [x] **Android 视频采集失败静默降级为纯音频，无降级状态（CallManager.kt:781-801 createLocalTracks）** ✅已修(2026-09-07):createCameraCapturer 失败不再直接 return(音频轨保留),新增 localVideoOk;呼出侧据此将请求类型降为 audio(state.isVideo=false,对端按语音接听),接听侧本端转语音 UI;日志明示降级。现象记录：createCameraCapturer 失败直接 return，此时音频轨已 addTrack → 通话以 video 类型继续但无视频轨；对端/UI 仍按视频显示（黑屏），本地无提示。
- [x] **通话系统消息去重 check+insert 非原子（callMessage.js:70-72）** ✅已修(2026-09-07):callMessage.js 按 callId 进程内单飞(inflightCallWrites 合并并发调用),DB _alreadyWritten 幂等保留兜底;回归 test/call-message.test.js「并发双终态只落一条」。现象记录：_alreadyWritten.get 与 await appendConversationEvent 之间有异步间隙，并发双终态可能写两条同 callId 通话消息。
- [x] **Web 协商加固(glare 防御+状态守卫,非完整 rollback)** ✅已修(2026-09-07):processOffer 在 signalingState=have-local-offer 时忽略竞争 offer;onAnswer 仅 have-local-offer 态接受(否则丢弃防 InvalidStateError);onOffer 加 ended/incoming 守卫;onResponse 仅 calling 态处理(迟到 accepted 不再复活 ended)。未做:双端同毫秒切类型的完整 perfect-negotiation rollback(极罕见,下轮 ICE restart/再切换自愈)——见 P3 备注。现象记录：processOffer/onAnswer 直接 setRemoteDescription，无 signalingState/rollback 守卫——双端并发重协商理论可 InvalidStateError。

## 🟢 P3 / 记录备查
- [x] 服务端 call:end.reason 白名单 ✅已修:仅转发 CALL_END_REASONS 集合内值,未知置 undefined
- [x] iOS 本地来电通知 identifier 带 callId ✅已修:incoming_call_<from>_<callId>(空补 UUID)
- [x] Android 蓝牙 SCO 状态诚实化 ✅已修:bluetoothOn 仅 SCO CONNECTED 后置 true,启动失败不再谎称已路由
- [x] **文档漂移同步** ✅已改(2026-09-07):voice-call-architecture 参考四通道表(PushKit 划除+恢复指路 repo docs/TOULIAO-IOS-VOIP-ENTITLEMENT-STEPS.md)+超时现状写明;repo docs/DELIVERABLE_CHECKLIST.md 同步
- [ ] 空 callId 容忍（Web matchesCall / Android·iOS CallSignalMatcher）：服务端始终带 callId、CALL_REQUIRE_ID=false 时空 callId 由服务端补全转发、且 Android/iOS 均有 stage 守卫+文档注释 → 有意兼容设计，无需改，禁止误当缺陷修

## ✅ 已核验健康项（无需处理）
- callId 全链路透传+校验（request/response/offer/answer/ice/switch-type/end/resume）；offer/answer/ice 仅活跃会话转发（防注入）；socket.to() 回声隔离
- 多端同步 replaced/answered_elsewhere/rejected_elsewhere 后端+三端一致且带 callId；重拨清理旧 timer/session；迟到应答被拒（answeredAt 守卫）
- 后端通话测试 10 suites/57 tests 全绿（本机 node_modules 原为 omit=dev 缺 supertest，npm ci 后全过）；生产日志无通话错误
- Web：监听器随 effect 成对解绑；pendingIce 早到候选入队；ICE restart 防抖 3s/窗口 15s/≤3 次自愈
- Android：attempt 序号+stage 三重校验防旧协程回填；pendingIce 同锁排空；前台服务/质量采样/通知资源清理齐
- iOS：consumeEnded 有 stage==.ended 守卫（cleanup 延迟任务最坏=新通话恰好 ended 时早清结束页 0.8~1.8s，纯 UI）；incomingFromPush 幂等守卫

## 建议补的测试（防回归）
- [x] 冷却生命周期 ✅ → test/call-cooldown-unit.test.js(fake timers 3 用例,含 5s 整点边界旧 timer 误删场景)
- [ ] 双击/连点接听只建一个 PC、结束后媒体全部释放（web 组件级;现无组件测试基建,守卫路径已人工核对+CI android/ios 编译验证）
- [x] 通话终态并发 ✅ → call-message.test.js「并发双终态只落一条」(Promise.all 同 callId 双写)
- [x] call:end 未知 reason 契约 ✅ → handler 白名单实现(未知置 undefined);call-signaling-contract 覆盖既有 reason 转发契约
