# 添加与切换账号修复

按用户最新要求，Android/iOS 使用现有单应用内的添加、切换账号功能，不制作或发布应用分身；Windows 保留桌面图标重复启动自动多开。
本轮基线为 `f905aec7`。此前移动分身草稿保存在原工作区及私有证据目录，没有混入本轮发布源码。

## 修复

- Android 推送注册和删除显式绑定发起时的凭据快照，网络拦截器拒绝过期快照；iOS 网络请求增加同等约束。
- 两端串行执行推送归属变更，切号清理等待已经发出的注册结束；旧账号的排队操作不能借用新账号的凭据。iOS 获取 FCM token 在队列之外，不阻塞退出。
- 按经过认证的登录会话删除本机订阅，不依赖 SDK 能否重新返回设备 token。Android 每次登录补报已有个推 CID；iOS 保留应用级 APNs token 供下次登录重新绑定。
- 改密安装新会话凭据后，两端重新注册推送，避免旧会话级联撤销订阅后永久收不到通知。
- 切号或退出时清除旧通知与待打开会话，并释放旧通话媒体资源。Android 群通话增加请求序号，旧 ICE 请求不能恢复新一轮通话的采集。
- Android、iOS 和厂商通道通知都携带实际接收账号。展示及通知点击检查当前账号；不把旧通知路由到新账号，不自动切换账号。
- iOS APNs/FCM 和 Android 来电 FCM/个推只在同一登录会话内去重，不能由一台设备屏蔽同账号的其他设备。
- 延迟到达的推送失败只清除发送时对应的完整归属，不能删除后来重新绑定的设备或 Web 订阅。个推重试前重新检查归属。
- 修复 Android CI 安装已下架的 `tools` SDK 包及 iOS 历史测试夹具的 Swift 字符串语法错误。
- Android 正式包发布前安装到模拟器并检查原生登录界面，文件上传使用临时文件替换、公网内容比对和固定 SSH 主机公钥。

## 验证记录

- 推送专项：6 套、53 项通过，使用真实隔离 SQLite 数据库；外部推送服务用明确的替身，不等于实际送达。
- [最终后端/Web CI](https://github.com/zhaocaimao008/touliao/actions/runs/34979438223)通过，源码 `cf58e122`：后端 112 套、879 项通过、1 项跳过；Web 33 套、240 项通过，Lint、Capacitor 与迁移门禁通过。
- [Android 编译与单测](https://github.com/zhaocaimao008/touliao/actions/runs/34978897584)：95 项通过，包括账号快照、过期请求、串行清理与通知接收人测试。
- [iOS 编译与单测](https://github.com/zhaocaimao008/touliao/actions/runs/34978894925)：59 项通过，0 失败。
- [Android 正式签名包](https://github.com/zhaocaimao008/touliao/actions/runs/34979197799)：签名构建、单测、模拟器安装启动通过；登录截图无裂图，检查无启动崩溃。实际 APK 包名为 `com.touliao.app`，版本 `81 / 8.1.24`，与旧版签名证书相同。
- [Windows 发布者门禁](https://github.com/zhaocaimao008/touliao/actions/runs/34978906010)通过：接受可信签名程序，拒绝当前未签名安装包和被篡改的签名程序。
- Android APK SHA-256：`0631c12bd21cd7abd1518d4357b8f617bbe65c699b4fe82b27ab4deeb3568763`。APK v2/v3 签名验证通过；证书 SHA-256：`345e9485b4220e607c40afee304f16ca00f87d6f080184423defc0ea1e85983c`。
- [iOS TestFlight 8.1.24](https://github.com/zhaocaimao008/touliao/actions/runs/34980219307)正式构建、Apple 校验、上传通过；App Store Connect API 确认构建 `1789481788` 处理状态为 `VALID`，构建 ID 为 `ff80e518-7d8d-4749-a2a9-d6465865ceec`。未提交外部 Beta 审核或 App Store 审核，这不等于 App Store 上架。
- 下载 IPA 后解析实际 Info.plist 和签名描述文件：应用 ID `com.touliao.app`、版本 `8.1.24`、构建号 `1789481788`、iOS 26.5 SDK、APNs 为 production、调试权限关闭。IPA SHA-256：`cf2ca4a72f2682f94e2b06ffd58c932cfdb6f04ba6481ec175fb37739a7163c0`。

## 已发布及复验

- 后端 `8.0.5` 已从经过全量测试的源码部署，只有投聊进程被重启；其他三个项目进程 PID 不变。依赖锁除本包版本外未变化，无数据库迁移。
- 重启就绪前短暂出现 502，自动重试后健康检查通过，随后公网与浏览器复验正常。数据库完整性及外键检查通过，用户 13、消息 107、会话 11、登录会话 16、迁移 154，部署前后未变化。
- 后续连续 5 次公网健康检查全部正常，投聊进程无额外重启，结构化证据见私有目录 `production-verification.json`。
- Android `8.1.24 / 81` 已发布到 [正式下载地址](https://touliao.cc/downloads/touliao-android-latest.apk)，更新清单已同步。公网 APK 为 56,808,304 字节，与上面经过模拟器启动测试的产物逐字节相同，SHA-256 一致。
- Windows 保持 `8.1.23`，本轮复验公网安装包、Ed25519 更新签名、大小与哈希均通过。此前已验证桌面图标连续启动的独立实例；本轮不改该行为。
- Web 保持 `8.1.23`。公网静态资源与原测试构建一致；浏览器桌面 1440x900、手机 390x844 检查：裂图 0、脚本错误 0、水平溢出 0。
- 部署前数据库备份 `touliao-20260915_141502_582825917.db.gz` 恢复验证通过；部署后[私有异地备份 34980647640](https://github.com/zhaocaimao008/touliao-private-backups/actions/runs/34980647640)通过，解密后验证 56 张表和 2 个归档，完整性正常、外键错误 0。配置及数据库、WAL、SHM 权限均为 600。
- 原工作区 8 份移动草稿逐一核对保留，只有 Gradle 正式版本递增；分身参数、独立包名和分身更新清单没有进入正式构建。

## 仍需外部条件

- TURN 云防火墙阻断已于同日后续处理解除：用户添加规则后，三种传输的外网鉴权和独立 relay-only 双向媒体测试连续通过，15:03 UTC 已启用生产配置。详见 [TURN 启用记录](TURN-ACTIVATION-2026-09-15.md)，其中保留中途一次 UDP 超时及验收边界。
- 没有 Windows 发布者证书。未来正式发布必须配置 `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD`，强制签名，并用 Windows 验证安装包及应用签名的可信状态和时间戳。现有 Windows 8.1.23 不重新打包或伪装为已签名。
- Windows 的可信发布者依赖有效证书或完成身份验证的签名服务，不能用 Ed25519 更新签名替代；签名本身也不是 SmartScreen 永不提示的保证。参见 [Microsoft 签名信任模型](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models)。
- 本轮保留现有“当前账号在线、保存其他账号供切换”的行为，不把账号列表改造成多个账号同时在线。外部推送服务已经接受的在途通知不可撤回，尤其后台由系统展示的通知不经过应用过滤；不能承诺零在途通知。
- 模拟器、单测和安装验证不能替代真实 FCM/APNs/厂商推送、锁屏通话及不同手机网络的验收。

## 证据

私有证据目录：`/home/ubuntu/touliao-account-fixes-evidence-20260915`。包含原移动草稿及构建日志，不要上传整个目录。
实现依据：[Retrofit 请求 Tag](https://github.com/square/retrofit/blob/trunk/CHANGELOG.md)、[Apple APNs 注册回调](https://developer.apple.com/documentation/uikit/uiapplication/registerforremotenotifications())、[Android Emulator Runner](https://github.com/ReactiveCircus/android-emulator-runner)。

## 后续：iOS 正式送审（2026-09-15 17:09 UTC）

用户要求直接提交 `8.1.24`。本次提交的是正式 App Store 审核，不是外部 TestFlight Beta 审核；更新本页前述“未提交 App Store 审核”的历史状态。

- 撤回旧版 `8.1.18` 的审核提交 `7de8c5ef-ac5f-4c0e-ae08-7efd4ca067c9`，确认其状态为 `COMPLETE` 后，保留原商店版本记录与截图，将版本改为 `8.1.24`。
- 精确关联已通过处理的构建 `1789481788`，构建 ID `ff80e518-7d8d-4749-a2a9-d6465865ceec`；没有重新打包或混入未提交的移动端草稿。
- 原审核资料所列账号在当前生产库不存在。通过正常注册接口创建一个普通权限专用审核账号，采用随机密码，更新苹果审核资料。实际登录、资料读取、退出均通过；测试会话已清理，没有修改已有用户的密码。
- 保留三张已完成上传的截图、联系信息和现有发布设置；删除商店描述中未实现的“消息端到端加密”表述，不作新的隐私或合规声明。
- 新提交 ID `32c47e08-ca89-41aa-8248-028834c0f8d9`，苹果接收时间 `2026-09-15T17:09:02.775Z`。重复读取版本及审核提交均为 `WAITING_FOR_REVIEW`，版本/构建匹配；发布方式仍为 `AFTER_APPROVAL`。
- 送审前后数据库备份恢复验证均通过，SQLite 完整性正常、外键错误为零。新增审核账号后用户数 14，消息 107、会话 11、登录会话 16；未重启后端。

审核尚未通过，不代表已经上架，也不承诺审核完成时间。私有操作回执及审核账号资料位于 `/home/ubuntu/asc-work/submission-8124-20260915`（目录 0700、文件 0600），不得提交凭据到仓库。
