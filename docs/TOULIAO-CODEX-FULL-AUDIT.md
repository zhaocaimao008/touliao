# 投聊上线级全项目深度体检

审计日期：2026-08-31  
仓库：`/root/touliao`，分支 `main`，基线提交 `e76b2be`  
生产库：仅将 `backend-v2/wechat.db` 作为生产数据库；全程只读。根目录 0 字节 `wechat.db` 未使用、未删除。

## 结论

- 【投聊整体完成度】72%
- 【是否达到正常用户使用标准】YES（小规模、网络正常的 Web/Windows 日常聊天）；Android/iOS 弱网与跨端媒体仍需限制性说明
- 【是否达到正式发布候选标准】NO
- 【功能完整度】78%：常规消息、好友、群聊、附件、撤回/个人删除已有实现；可靠同步协议、跨端通话、多设备通话仍未闭环
- 【四端对齐度】68%
- 【UI/UX】75%：Web 已有成熟聊天结构；真机 Safe Area、键盘、播放器、通话页未完成全量实测
- 【性能】63%：有分页/虚拟列表/批量广播，但存在 Worker listener 泄漏证据、超大群协议缺口和高 Swap
- 【稳定性】64%：Web 常规 E2E 较强；Android 重连补拉缺失，消息协议无单调 sequence
- 【安全】70%：主要 IDOR/群权限有后端守卫；依赖漏洞、部署方式、孤儿附件 owner 和秘密治理仍阻断 RC
- 【P0/P1/P2/P3数量】P0 2 / P1 9 / P2 8 / P3 7

状态只使用：`CODE_PASS`、`CI_PASS`、`RUNTIME_PASS`、`REAL_DEVICE_PASS`、`REAL_CROSS_PLATFORM_PASS`、`PARTIAL`、`FAIL`、`BLOCKED`、`REAL_DEVICE_REQUIRED`。

## TOP 20 问题

| # | 级别 | 问题 | 状态/证据 |
|---|---|---|---|
| 1 | P0 | 消息没有全局/会话单调 `sequence`；离线与增量同步仍依赖秒级 `created_at`，不能严格证明不丢不乱 | `FAIL`；`messages` 无 sequence，查询以 `(created_at,rowid)` 局部兜底 |
| 2 | P0 | Android Socket 重连没有等价的 reconnect catch-up；断线期间消息只靠重新进入/刷新历史偶然恢复 | `FAIL`；SocketManager 无 reconnected flow/补拉调用 |
| 3 | P1 | 生产库 462 条消息中 98 条 sender 外键孤儿，历史查询 INNER JOIN users 会把这些消息直接隐藏 | `FAIL`；只读 SQL 实测 |
| 4 | P1 | 生产库另有 18 个成员、8 个联系人方向、16 个附件 owner、1 个附件会话孤儿 | `FAIL`；`foreign_key_check` 与计数查询 |
| 5 | P1 | iOS 未监听 `new_message_notify`；在线 socket >500 的群降级后 iOS 收不到消息体，也不触发增量拉取 | `FAIL` |
| 6 | P1 | `missed()` 最多返回 300 条且没有续页 token；若被采用，长时间离线可截断 | `CODE_PASS`（存在实现）但语义 `FAIL` |
| 7 | P1 | 多设备通话服务端已发 `call:outgoing`，四端没有消费入口；其他设备无法正确显示/收起呼出态 | `PARTIAL`；后端源码明确备注客户端未实现 |
| 8 | P1 | 通话状态存在单进程内存 `activeCalls`，进程重启/多实例会丢进行中状态 | `FAIL`；源码明确说明无 Redis/DB 镜像 |
| 9 | P1 | TURN/STUN 仅代码验证了临时 HMAC 凭据；UDP/TCP/TLS 5349/relay candidate 未做双网络真机验证 | `REAL_DEVICE_REQUIRED` |
| 10 | P1 | 自动部署在生产执行 `git reset --hard`，违反项目安全禁令，且部署/回滚会直接重建运行目录 | `FAIL`；`.github/workflows/deploy.yml` |
| 11 | P1 | Backend 全套 Jest 反复触发 Worker `MaxListenersExceededWarning`，并靠 `--forceExit` 退出 | `FAIL`；69 suites 运行态证据 |
| 12 | P2 | Web 全套 39 E2E 中 EDGE-06 失败 1 条；隔离重复 2/2 通过，属于未消除 flake，不能报全绿 | `PARTIAL`：38/39 |
| 13 | P2 | Backend 562 测试中 1 条限流测试因全局 `DISABLE_RATE_LIMIT=1` 被 skip，限流未纳入完整套件 | `PARTIAL`：561 pass / 1 skip |
| 14 | P2 | Android 仅两个单测文件；关键 Socket、媒体、好友、群权限、通知没有充分自动化覆盖 | `PARTIAL` |
| 15 | P2 | iOS 只有缓存单测，Linux 环境无 Xcode，CI/签名/播放器无法本轮运行验证 | `BLOCKED` / `REAL_DEVICE_REQUIRED` |
| 16 | P2 | Backend 锁定依赖审计报告 11 个 moderate；含已弃用且有风险提示的 multer 1.x | `FAIL`（供应链门禁） |
| 17 | P2 | Electron pack 依赖默认写 `/root/.cache/electron`，受限环境失败；构建脚本未提供可移植缓存路径 | `BLOCKED` |
| 18 | P2 | CI 注释与 job 名仍写 35 条 E2E，真实为 39，发布证据会误导 | `FAIL`（文档/门禁漂移） |
| 19 | P3 | Web 生产构建含约 1.26 MB PDF worker、470 KB PDF、430 KB XLSX、173 KB DOCX chunk，附件预览首用成本高 | `CI_PASS`，优化项 |
| 20 | P3 | 当前主机 Swap 8 GB 已使用 6.3 GB；未取得生产进程级历史曲线，不能把原因归因于单一服务 | `PARTIAL` |

## 消息可靠性结论

`client_msg_id` + 唯一索引 `(sender_id, client_msg_id)`、ACK 在 worker commit 后返回、客户端按 server `id`/`client_msg_id` 认领乐观消息，这一段为 `RUNTIME_PASS`（Web 隔离 E2E 覆盖并发、断线、重发）。但没有明确 `server_msg_id` 字段契约和单调 sequence；Web/iOS/Android 三种重连策略不同，故消息系统整体只能 `PARTIAL`。

Web 当前会话在重连后以 `disconnectAt-1s` 拉 100 条；iOS 重连后重载当前历史；Android没有对等补拉。非当前会话依赖会话列表刷新而不是统一的 per-device sync cursor。不能证明在 100+ 同秒消息、长时间离线、多设备并发读删场景中严格不丢、不复活。

## 本轮已经修复的问题

本轮没有贸然修改生产协议、数据库或核心 UI。只安装/重建了本地测试依赖与隔离缓存（均为可再生、未提交产物），并生成本组审计报告。发现的 P0/P1 都涉及协议、移动端生命周期、生产数据修复或部署策略，不能归类为“明确低风险一行修复”。

## 还没有真正打通的功能

- Android 断线重连自动补拉、多会话同步游标。
- iOS 超大群 `new_message_notify` 增量恢复。
- 四端 `call:outgoing` 多设备呼叫状态。
- 进程重启/多实例下通话状态恢复。
- 严格 sequence/游标驱动的离线同步与大批量续页。
- iOS→Android 视频/语音真实历史样本跨端播放闭环。
- TURN UDP/TCP/TLS 强制 relay 的双外网真机闭环。
- iOS/Android 后台、锁屏、蓝牙、听筒、来电通知全矩阵。

## 需要真机验证的问题

- iOS 发视频/语音给 Android：首帧、duration、00:00、Range 206、耳机/扬声器切换。
- Android/iOS 锁屏推送、通知点击、拒接/接听、杀进程后恢复。
- 双网络强制 relay：TURN UDP、TURN TCP、TURNS 5349、TLS 证书与 relay candidate。
- Safe Area、软键盘遮挡、长按菜单、文件预览、后台播放器和内存释放。
- Windows 安装、自动更新签名、系统休眠唤醒和真实 Windows WebRTC 设备。

## 分端结论

- 【Web结论】`PARTIAL`：lint、83 Vitest、生产 build 通过；39 E2E 为 38 pass/1 fail，失败项隔离 2/2 pass。常规聊天可用，不能视为 100% 门禁通过。
- 【Windows结论】`PARTIAL`：共享 Web 渲染层 build 通过；Electron 打包在缓存权限处阻断，真实 Windows 安装/更新/媒体/通话为 `REAL_DEVICE_REQUIRED`。
- 【Android结论】`PARTIAL`：单测 `BUILD SUCCESSFUL`，但重连补拉缺口为核心阻断；debug assemble 在沙箱网络 socket 限制下未取得最终证据。
- 【iOS结论】`BLOCKED`：源码审计可到 `CODE_PASS` 的功能较多，但无 xcodebuild，且超大群通知缺口明确；真机项为 `REAL_DEVICE_REQUIRED`。
- 【Backend结论】`PARTIAL`：69 suites、561 tests 通过，1 skip；存在 listener/open handle 警告、sequence/同步协议缺口、11 moderate 依赖风险。
- 【数据库结论】`FAIL`（RC 门槛）：`integrity_check=ok`，但 foreign key 孤儿大量存在；在备份、分类和修复脚本演练前禁止写入清理。

## 测试结果

| 项目 | 结果 |
|---|---|
| Backend Jest | `PARTIAL`：69/69 suites；561 pass、1 skip；listener 警告，force exit |
| Web lint | `CI_PASS`：0 error；有 ESLint 配置迁移警告 |
| Web Vitest | `CI_PASS`：9 files / 83 tests |
| Web Playwright | `PARTIAL`：38/39；EDGE-06 全套失败，隔离 repeat 2/2 通过 |
| Android unit | `CI_PASS`：Gradle build success；仅少量覆盖 |
| Android assemble | `BLOCKED`：沙箱禁止 Gradle daemon 本地 socket；非源码编译错误 |
| Electron pack | `BLOCKED`：默认缓存 `/root/.cache/electron` 只读 |
| iOS CI/build | `BLOCKED`：当前 Linux 无 Xcode |

## Build/CI 结果

Web production 与 desktop mode 渲染包均构建成功。当前 CI 定义有后端覆盖率、Web lint、E2E 门禁，但部署脚本使用生产 `reset --hard`，且 E2E 数量描述漂移；因此整体仅 `PARTIAL`，不是发布候选。

## 下一步最值得升级的功能

优先做“统一设备同步游标”：为每个会话引入单调 server sequence，API 返回 `next_cursor/has_more`，四端共享同一 reconnect catch-up 契约，并覆盖 1000 条离线消息、同秒突发、多设备删除/撤回/已读。它同时解决当前最高风险的丢消息、乱序、Android/iOS差异和大群降级恢复问题。
