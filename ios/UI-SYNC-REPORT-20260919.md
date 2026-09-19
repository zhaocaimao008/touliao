# 投聊 iOS 最新 UI 同步记录（2026-09-19）

本次在独立分支 `ui/ios-latest-20260919` 完成 iOS 源码接续、遗漏补齐和回归。没有进行生产发布，没有合并 main，没有提交 App Store。Windows 8.1.27、Windows 自动更新及 Android / Web / Server 的现状均保持。

工作区：`/home/ubuntu/touliao-ios-ui-20260919`。证据目录：`/home/ubuntu/touliao-ios-ui-evidence-20260919`。

## 基点、来源和操作范围

- 开始时 main、Windows 发布工作区和设计系统工作区均干净。
- checkpoint：`checkpoint/ios-ui-before-20260919`，提交 `793b8103fc739fa0f0bd0ab8ace3a24a1a4ea41b`。同时保存此版本与 main 原 iOS 的两份 tar.gz，SHA-256 见 `checkpoint.json`。
- main 仍是 `45dccd9963cad8dec00ef8d13019207491016fb4`。检查发现此前设计分支已经包含一套未发布的 iOS 新 UI，故保留并接续这套成果，不把它当作本次全部重写。
- 视觉参考为 Windows 8.1.27 发布源与 Android 已发布 UI；原设计 tokens、136 个矢量资源的生成校验通过。Android feature/ui 源码和 Windows UI tokens 与发布源一致。
- 只读访问的 Web 入口 CSS 未包含新版投聊蓝变量，因此不把该入口当成唯一的新版标准；按用户要求保持 Web 原样。参照判断见 `visual-reference-validation.json`。
- 相对 checkpoint，本次所有代码和测试改动均在 `ios/`；Core、Data、26 个 ViewModel 类、媒体选择/上传入口、WebSocket/通话管理器、project.yml、正式签名文件、其他端及所有工作流保持不变。详见 `scope-validation.json` 和 `viewmodel-source-preservation.json`。

## 1. 页面

本次补齐或修复：登录、注册、消息列表、单聊/群聊、图片画廊、视频/PDF 预览、文件详情、通讯录、搜索、单人语音/视频通话、群来电和群通话。

接续已有新版 UI 并完成源码对照与编译：好友申请、添加好友、建群、群成员/邀请、群设置/公告、个人中心、编辑资料、账号/设备、通知/隐私/外观等设置、会话文件、引用/转发/撤回/删除入口、通话记录，以及原有收藏/朋友圈等入口。页面对应 36 个业务视图文件；另有根视图和底部导航。逐项见 `page-mapping.csv`。截图及交互测试的实际覆盖在第 5/6 节单独说明；未把源码未改等同于所有交互已实测。

## 2. 公共组件

本次新增/完善：`TouliaoField`（持久字段标签）、`TouliaoBadge`（角标）、`TouliaoToast`/Toast modifier、`PasswordField`、`MediaPreviewToolbar`、`AttachmentPlayback`、聊天自适应输入布局。

继续复用已接入的设计 tokens、Theme/字号/圆角、136 个线性图标、头像、主按钮/加载状态、空状态、通话按钮及原生弹窗/菜单/Action Sheet。系统媒体选择器、分享面板和系统权限弹窗保持原生能力。

## 3. 替换的旧 UI

交付源码相对 main：旧极光紫/青渐变主题和气泡、旧灰色列表/表单表面、零散图标与尺寸已由同一套投聊蓝、深浅色语义变量和原生组件替代。本次进一步替换固定宽度输入区、固定高度表情区、旧深色文件说明页、固定顶部偏移的媒体工具栏与旧 Toast；增加与新版一致的全部/未读/群聊显示筛选。

## 4. 修复的问题

- 窄屏/大字号时群聊工具按钮挤压输入框：空间不足时输入框独立一行；表情与附件面板可滚动，键盘与面板焦点互斥。
- 保存状态或提示刷新可能重建 AVPlayer：播放器随预览页保留，离开页面暂停；上传、下载和鉴权调用不变。
- 视频/PDF 工具栏和通话控制区使用 Safe Area；群来电长文与操作分行，通话身份区可滚动。
- 连续 Toast 的旧计时任务取消后误清除新提示；图片画廊复用修复后的提示，切换图片重置缩放。
- 密码框边框被背景遮挡；发出气泡里的 @提及、文件大小/图标对比度不足。
- 统一角标与搜索筛选触区；修正联系人 AI 助手数量显示为插值原文的问题。
- 补充测试时修正了过时的 CGRect 诊断字符串 API，并让图片下载器显式使用测试传输，防止图片占位状态被误计为通过；均属于测试修正。

## 5. 编译与 6. 测试

| 模块 | 构建与测试 | 结果 |
| --- | --- | --- |
| 登录/注册与公共表单 | [原生运行 35426733927](https://github.com/zhaocaimao008/touliao/actions/runs/35426733927) | 63 测试通过 / 79 截图 |
| 聊天输入与媒体预览 | [原生运行 35426972923](https://github.com/zhaocaimao008/touliao/actions/runs/35426972923) | 65 测试通过 / 89 截图 |
| 会话/通讯录/搜索 | [原生运行 35427035764](https://github.com/zhaocaimao008/touliao/actions/runs/35427035764) | 67 测试通过 / 89 截图 |
| 通话布局与媒体回归 | [原生运行 35427193867](https://github.com/zhaocaimao008/touliao/actions/runs/35427193867) | 70 测试通过 / 91 截图 |
| 最终完整回归 | [原生运行 35428907093](https://github.com/zhaocaimao008/touliao/actions/runs/35428907093) | 71 测试通过，0 失败 / 101 截图 |

最终受测提交：`cf97c1830d1290595e3bbc4295eb0e4a949ea917`。文档提交后再次确认产品与测试目录树完全相同。

环境：macOS / Xcode 16.4、iOS Simulator；使用原有 `ios-build.yml`，没有修改工作流。应用构建禁用签名；测试宿主仅使用模拟器 ad hoc 签名，无正式发布证书操作。

通过的回归包括：原有缓存/消息合并/分页/账号与凭据隔离/待发送队列/通话信令与 SDP；会话显示筛选；播放器对象保留；Toast 替换计时；图片/视频/PDF/文件打开路由；图片/视频/文件/语音 multipart 请求体与鉴权；MP4 下载字节完整性、解码和原生播放器渲染。

键盘测试在真实原生 UITextView 上执行 first responder、中文组合输入、粘贴换行归一化、长文本自动换行与收起；输入高度由 20 pt 增至 114.5 pt，并断言输入区位于屏幕键盘上方。草稿和原有换行处理逻辑保留。

图片截图检查已确认 Kingfisher 下载图片并成功解码进入缓存，再输出深浅色消息截图；测试图片使用本地生成的蓝色矩形。不是仅凭占位图通过。

截图包含深浅色页面、320 pt 大字号输入/表单/文件/Toast/通话控制场景和富媒体气泡。原生截图对照位于证据目录 `review/index.html`，构建日志和 xcresult 位于 Actions 的 `xcodebuild-log` 工件。

补充测试过程中出现过一次测试编译错误（已替换不可用的 CGRect 字符串 API），相关失败记录保留；最终受测提交已重新通过。

测试是 macOS / Xcode 原生编译和 XCTest，不以 Linux 静态扫描或浏览器截图替代。业务接口测试使用进程内隔离传输，媒体测试使用 `.invalid` 域名或本地测试文件，没有使用生产账号、写生产数据库或拨打真实电话。语音上传测试只检查 MIME、duration 和请求体；不等于实际麦克风录音验收。

## 7. 剩余验证边界

- 视频气泡的远程缩略图仅验证占位布局；模拟域名不由 AVFoundation 的远程加载器接管。真实 MP4 的下载、解码和预览播放器另有通过的独立测试。
- 未连接 iPhone 真机，未验证真实相册/iCloud 视频选择、相册保存权限、麦克风录音/语音硬件播放、第三方文件 App 接管。
- 未做真实服务器的双人单聊/群聊、断网/切网重连、后台恢复、推送/CallKit、语音视频互拨及蓝牙路由联测。对应旧业务实现完整保留，已有账号/缓存/信令单测通过。
- 原生弹窗、Action Sheet、撤回/删除/转发菜单未逐个进行点击和真实发送联测；原回调与业务实现保留。
- 原生截图含 320 pt / accessibility3 约束，但并非所有刘海/灵动岛设备的真机验收；页面返回手势、iOS 16 实机及系统权限拒绝矩阵仍需设备验证。
- 仍有既存 Swift 并发/弃用 API/AppIcon 尺寸警告；未在此次 UI 任务中扩展修改业务层或正式发布证书。
- 无 IPA、TestFlight 或 App Store 发布。当前交付为独立分支源码、源码补丁、原生编译/测试日志、截图及对照页。

## 交付和证据

- [页面对应表](ui-sync-evidence/20260919/page-mapping.csv)
- [iOS 风险项目逐项回归](ui-sync-evidence/20260919/ios-risk-regression.csv)
- [完整运行记录](ui-sync-evidence/20260919/validation-summary.json)
- 本地 `ios-ui-source-only.patch` 只包含相对旧 main 的 iOS 产品 UI；分支基点是现有发布源码，后续集成应限定 iOS 路径，不能把基点已有的其他端历史当成本次改动。
- 生产只读复核：Windows 更新清单及签名、Android 版本清单、Web 入口与 CSS 均与任务开始时字节一致。未执行部署、版本切换或数据库操作。
