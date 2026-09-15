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
- [最终后端/Web CI](https://github.com/zhaocaimao008/touliao/actions/runs/34979438223)通过，源码 `cf58e122`，包括最后两项推送回归。
- [Android 编译与单测](https://github.com/zhaocaimao008/touliao/actions/runs/34978897584)：95 项通过，包括账号快照、过期请求、串行清理与通知接收人测试。
- [iOS 编译与单测](https://github.com/zhaocaimao008/touliao/actions/runs/34978894925)：59 项通过，0 失败。
- [Android 正式签名包](https://github.com/zhaocaimao008/touliao/actions/runs/34979197799)：签名构建、单测、模拟器安装启动通过；登录截图无裂图，检查无启动崩溃。实际 APK 包名为 `com.touliao.app`，版本 `81 / 8.1.24`，与旧版签名证书相同。
- [Windows 发布者门禁](https://github.com/zhaocaimao008/touliao/actions/runs/34978906010)通过：接受可信签名程序，拒绝当前未签名安装包和被篡改的签名程序。
- Android APK SHA-256：`0631c12bd21cd7abd1518d4357b8f617bbe65c699b4fe82b27ab4deeb3568763`。APK v2/v3 签名验证通过；证书 SHA-256：`345e9485b4220e607c40afee304f16ca00f87d6f080184423defc0ea1e85983c`。
- [iOS TestFlight 8.1.24](https://github.com/zhaocaimao008/touliao/actions/runs/34980219307)正在构建上传，未提交外部 Beta 审核；这不等于 App Store 上架。
- 后端与 Android 公网发布验证将在完成后补记。部署前数据库备份 `touliao-20260915_141502_582825917.db.gz` 恢复验证通过，数据库完整性与外键检查通过。

## 仍需外部条件

- TURN 外网复验 [34977567875](https://github.com/zhaocaimao008/touliao/actions/runs/34977567875)仍失败，服务器身份调用 Lightsail 管理 API 返回 AccessDenied。放行 TCP/UDP 3478、TCP 5349、UDP 41000-41999 并通过外网分配与 relay-only 双向媒体测试之前，不启用待配置的 TURN。
- 没有 Windows 发布者证书。未来正式发布必须配置 `WINDOWS_CERTIFICATE_BASE64`、`WINDOWS_CERTIFICATE_PASSWORD`，强制签名，并用 Windows 验证安装包及应用签名的可信状态和时间戳。现有 Windows 8.1.23 不重新打包或伪装为已签名。
- Windows 的可信发布者依赖有效证书或完成身份验证的签名服务，不能用 Ed25519 更新签名替代；签名本身也不是 SmartScreen 永不提示的保证。参见 [Microsoft 签名信任模型](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models)。
- 本轮保留现有“当前账号在线、保存其他账号供切换”的行为，不把账号列表改造成多个账号同时在线。外部推送服务已经接受的在途通知不可撤回，尤其后台由系统展示的通知不经过应用过滤；不能承诺零在途通知。
- 模拟器、单测和安装验证不能替代真实 FCM/APNs/厂商推送、锁屏通话及不同手机网络的验收。

## 证据

私有证据目录：`/home/ubuntu/touliao-account-fixes-evidence-20260915`。包含原移动草稿及构建日志，不要上传整个目录。
实现依据：[Retrofit 请求 Tag](https://github.com/square/retrofit/blob/trunk/CHANGELOG.md)、[Apple APNs 注册回调](https://developer.apple.com/documentation/uikit/uiapplication/registerforremotenotifications())、[Android Emulator Runner](https://github.com/ReactiveCircus/android-emulator-runner)。
