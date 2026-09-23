# 投聊 Android / iOS 原生 UI 改版交付

## 范围与基点

- 工作区 `/home/ubuntu/touliao-design-system-20260918`，分支 `ui/design-system-20260918`。开始时 Git 干净。
- 从 `20aef960bc2bafbeb1610b9fb48734634dea098b` 接续；保留 `aa740615`、`755aac1b`、`b4f551b7`、`31b8d322`、`20aef960` 五次 Web / Windows 提交，不回退或重做。
- 设计原件 `/home/ubuntu/touliao-ui.zip`；SHA256 `746211b1de546c6d82b758d1e03d1e06dec0a5611ae8f15e550a4dd547d4e229`。42 页、66 类组件、136 图标与深浅主题继续使用同一份设计变量和原型参考。
- 本轮仅改原生 UI、对应测试、构建取证工具及文档。后端、API / WebSocket 协议、Core / Data / ViewModel、Web / Electron 代码相对于接续基点无差异。
- 仅推送审阅分支、运行构建与模拟器任务；未合并、未打发布标签、未发布、未部署，也未操作生产数据。

## 完成内容

| 模块 | Android / iOS 实施 |
| --- | --- |
| 主题与字体 | 原设计 tokens 生成两端语义色，保留应用主题偏好；系统中文字体；12 / 14 / 16 / 18 / 22 / 28 文字规格和分级行距；浅色辅助文字使用与 Web 相同的可读衍生色 |
| 图标与基础组件 | 各端 136 个原始设计矢量；圆角头像、空态、平面主按钮、输入框、卡片与分隔线；加载按钮保持文字占位，避免高度跳动；iOS 系统主按钮显式使用主按钮文字色；设计包未覆盖的业务 / 系统符号保留语义回退 |
| 会话与聊天 | 会话行、置顶、未读与文字层级；平面气泡、统一圆角和内边距；应用主题与气泡同步；输入工具与附件面板图标、44 / 48 最小触区；Android 窄屏 / 大字标题与操作菜单 |
| 认证、联系人与群 | 登录 / 注册安全区及键盘滚动，找回密码说明；联系人、申请、标签、黑名单、搜索、建群、成员、群资料 / 公告与权限展示；保留原有入口和调用 |
| 资料与设置 | 资料 / 编辑、二维码、邀请、设备、账号、通知、隐私、外观；iOS 改号 / 改密 / 注销 / 勿扰；二维码内容可滚动，设置行可随字号增高；iOS 所有 List / Form 行与空页使用主题表面色 |
| 文件与内容 | 会话文件、收藏、朋友圈、发布、钱包与通话记录；系统文件 / 媒体组件保留，未改上传下载、播放、保存和分享逻辑 |
| 通话 | 深色媒体画布上的可读控制按钮，设计图标与开关斜线；控制区最多三列；Android 群媒体列表为控制区预留高度，深色通话画布采用白色系统栏图标并在退出后恢复；原权限申请、信令、媒体轨道、接听 / 拒绝 / 挂断回调保留 |
| 无障碍与手机布局 | Android sp 与安全区 / IME；iOS ScaledMetric、Dynamic Type、原生导航 / 键盘；应用小字号不能压低系统辅助功能大字；标准手机及 320 宽大字约束截图 |

技术栈保持 Android Kotlin 1.9.22 / Jetpack Compose / Hilt / Retrofit / Socket.IO / WebRTC，iOS Swift 5.9 / SwiftUI / UIKit / XcodeGen / Socket.IO / WebRTC。没有改为 WebView 或引入跨端框架。

逐项表覆盖 42 页、66 类组件和 30 项动作契约；原生页面审计包括 Android 34 个及 iOS 36 个业务视图文件（66 个直接调整，4 个继承共享主题或保留系统控件）。组件表给出实际源文件或明确的未接入原因；并不宣称每个原型变体都已移植。

原生仍是“消息 / 通讯录 / 我”三栏导航；设计原型的独立发现栏不替换现有导航。语音、转账、红包、财务和媒体画布的业务语义保留。未接入能力不会生成演示按钮。

## 构建与回归

| 项目 | 最终结果 | 环境与证据 |
| --- | --- | --- |
| Android 正常 debug / 原生测试 APK | 构建通过 | 本地 JDK 17 / SDK 34；最终云端 [35357001694](https://github.com/zhaocaimao008/touliao/actions/runs/35357001694)，提交 `33d03119` |
| Android JVM 回归 | **96 项通过**，0 失败 | 最终 CI 单测报告；消息 / 缓存 / 账号 / 信令等原有回归及主题对比度 |
| Android 原生模拟器 | **3 项通过**，76 张 PNG | API 34 / Pixel 2；真实 IME、登录按钮可达、返回、聊天菜单、附件面板滚动及主题截图 |
| iOS Simulator 构建 | 构建通过 | macOS 15 / Xcode 16.4；最终云端 [35357554756](https://github.com/zhaocaimao008/touliao/actions/runs/35357554756)，提交 `8cdb4aaf` |
| iOS XCTest | **63 项通过**，0 失败；79 张 PNG | 59 项已有回归 + 2 项设计可访问性 + 2 项原生画廊 / 控制布局；临时 ad hoc 模拟器签名用于测试 Keychain |
| 原生生成资源 | 276 文件一致性通过 | 两端设计语义色和各 136 图标，`generate-native-design.py --check` |
| 源码保护检查 | 通过 | 原五次提交均为当前祖先；后端 / Core / Data / 独立 ViewModel / Web / Electron 无差异；26 个嵌入 SwiftUI 文件的 ViewModel 类全文不变 |
| 改造前基线 | iOS 60 项通过；Android 构建通过、画廊成功但键盘滚动测试失败 | [iOS 基线 35355548334](https://github.com/zhaocaimao008/touliao/actions/runs/35355548334)、[Android 基线 35355551720](https://github.com/zhaocaimao008/touliao/actions/runs/35355551720)；基线原生产品代码与 `20aef960` 完全相同 |

最终 Android 代码与 `33d03119`、iOS 代码与 `8cdb4aaf` 的验证版本一致；交付尾部的文档 / 审阅工具提交不会改变原生产品代码。浏览器只用于验证离线审阅网页的图片链接和切换功能，不计作任何原生端或真机测试。

所有截图来自原生 Compose 或 SwiftUI / UIKit 渲染，fixture 只在测试 APK / XCTest 目标中，以 `.invalid` 地址和进程内拦截器提供数据；不进入正式业务代码。原生截图使用现有页面和 ViewModel / Repository，不能视为真实服务器业务成功。

Android 原生交互回归包括附件面板展开 / 收起、窄屏大字滚动至底部定时入口，登录按钮启用条件、手机号 / 密码输入、系统键盘、返回关闭键盘、找回说明和返回登录，以及大字号聊天操作菜单与返回。聊天及群截图断言历史消息和群名称已加载。没有提交真实登录，也未拨打真实电话。

iOS 原生回归包括已有消息合并、离线缓存、分页、账号 / 发件箱隔离、凭据 / 推送隔离、收藏、信令匹配与 SDP 单测，以及文字对比度、系统大字号优先和 SwiftUI 页面渲染。该套 XCTest 不等于完整 XCUITest 点击流程；iOS 键盘输入、边缘返回手势和媒体交互仍须真机补验。

历史取证中发现并修复的测试问题：Android 测试路由参数缺失造成空态；Gradle 卸载应用后图片被删除；iOS 并行测试克隆导致图片在另一容器。另补齐提及消息及邀请码的测试资料字段；前后对照使用相同字段、宿主 tint 与键盘收起条件。最终截图以正确路由和成功收集的原图为准，早期运行不计作完整截图通过。原版 Android 的滚动操作测试因页面没有滚动容器而失败，基线不是全通过；已保存的改版前图片可作视觉对照。

Android 审阅用 debug APK 保存于证据目录 `builds/android/`，对应最终 CI 构建；这不是生产发布包。iOS 当前只有 Simulator 构建和测试结果，没有签名真机 IPA。

## 截图与审阅包

- Android：改造前 **67** 张、改造后 **76** 张；新增面板包含浅色、深色和 320 dp / fontScale 2 约束。
- iOS：改造前 **77** 张、改造后 **79** 张；含 320 pt / accessibility3 约束及通话控制组件。
- 原生原图合计 **299** 张，另有用户设计的 **84** 张手机参考图。没有改造前原图的菜单 / 附件 / 通话控制组合明确显示缺图，不推断旧版画面。


审阅入口：`/home/ubuntu/touliao-native-ui-evidence-20260918/review/index.html`。可切换 Android / iOS、页面、深浅主题和标准 / 大字号，逐列查看原生改造前、改造后及用户设计参考。没有原图的组合明确为空，不补造截图。iOS 标准画布 390 × 844 pt，窄屏为 320 pt 的原生布局约束；Android 标准为 API 34 模拟器，窄屏约束 320 dp、fontScale 2。iOS 大字采用 accessibility3；页面截图先收起独立的系统键盘窗口，未包括系统键盘画面。通话截图仅审阅控制组件，不表示已建立音视频连接。

逐页源文件、截图及缺口见 `native-page-audit.csv`；完整图片清单在审阅包 `manifest.json`。包内保留 CI 日志、模拟器元信息、验证摘要、源代码差异、提交清单和旧 Web / Windows 审阅包；后者位于 `previous-web-windows/touliao-ui-review-20260918.zip`。报告与逐项表在 `docs/`，原设计七份交接文件在 `design-docs/`。早期失败 / 取消任务留在原始证据目录，不混作最终成功记录。

## 四端完成情况与待办

| 平台 | 代码 / 构建状态 | 验证边界 |
| --- | --- | --- |
| Web | 原五次提交保持；此前 Vite 构建、240 单测、415 Chromium 场景通过；本轮代码无改动 | 结果沿用之前报告，本轮未重复跑 Web；隔离测试不等于真实后端全链路 |
| Windows | 原共用 React UI 保持；此前桌面构建和 Windows 桥接 fixture 场景通过 | Windows 真机、字体实际渲染、125% / 150% 系统 DPI、安装 / 自动更新、摄像头 / 麦克风未验证 |
| Android | 原生主题 / 基础组件及已有业务界面已接入；debug 构建、单元测试、模拟器取证见上表 | 无手机真机；不同厂商系统、真实推送、硬件返回 / 摄像头 / 文件选择和完整业务链未验证 |
| iOS | 原生主题 / 基础组件及已有业务界面已接入；云端 Xcode / iPhone Simulator 结果见上表 | 无签名真机包 / 手机真机；真实键盘 / 手势、相机扫码、后台推送 / CallKit 和媒体链未验证 |

仍须对应设备 / 账号环境推进：

1. Windows 真机与 Android / iOS 手机的安装启动、主题切换、中文输入、系统字号、安全区、横竖屏、返回及前后台切换。
2. 测试账号的真实登录 / 注册、单聊 / 群聊消息发送接收 / 重试、附件上传下载 / 分享 / 相册权限和账号切换回归。
3. 四端真实语音 / 视频互拨、群通话、耳机 / 蓝牙、权限拒绝、网络切换、重连、后台来电及挂断；当前没有联测设备，全部未验证。
4. PDF / Office / 视频等媒体格式矩阵，所有弹窗 / 错误态 / 菜单的人工全量审阅；未截图的系统控件和通话状态不宣称通过。
5. 设计里尚无现有协议支持的扫码登录、短信认证 / 未登录自助重置、独立入群审批、全局文件中心、存储统计、反馈提交、链接元信息卡、全局撤销、上传手动暂停 / 恢复继续待接入。既有管理员协助找回、已登录改密、群邀请和会话文件保留。

这些是未验证或未接入项，不以浏览器测试、隔离接口或模拟器画面替代真机结论。

## 回退说明

没有生产部署，生产无须回退。原 Web / Windows 五次提交必须保留。需要查看本轮原生改造前，可另建只读参考工作区：

```bash
git -C /home/ubuntu/touliao-design-system-20260918 worktree add --detach /home/ubuntu/touliao-native-ui-rollback-review 20aef960bc2bafbeb1610b9fb48734634dea098b
```

以后若合并原生改版而需撤销，先保存届时未提交的工作，按交付包 `commits.txt` 中从新到旧的原生提交逐个 `git revert`。只处理 `20aef960..本轮交付提交`，不要回退此前 Web / Windows 五次提交，不执行全局 `reset --hard` / `clean`。`ui/native-baseline-review-20260918` 是基点加测试工具的取证分支，不应合并进产品分支。

验证重现：

```bash
python3 scripts/generate-native-design.py --check
ANDROID_HOME=/home/ubuntu/.local/share/vxin-android-sdk JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./android/gradlew -p android --no-daemon testDebugUnitTest assembleDebug assembleDebugAndroidTest
# 已有 API 34 测试模拟器时：bash scripts/native-review/run-android.sh
# iOS 必须在 macOS / Xcode 运行 ios-build.yml 中的 XcodeGen / xcodebuild 命令。
```
