# Touliao P2 follow-up plan

基线 72203094；分支 ui/design-system-p2-followup；checkpoint/design-system-before-p2-20260919。

批次：DS-001 同步；DS-002/028/029/030 生成与主题合约；DS-004/005/006/008/010/027 公共角色和页面；DS-022/023/024 通话与反馈；DS-025/026/003 空错/骨架与相关旧样式。每批构建/测试后提交。全部保留 issue ID，不以源码完成冒充验收完成。

## DS-001 P2

- 平台/页面：Web / Windows / 全局主题
- 位置：scripts/generate-ui-tokens.cjs:22; web/src/ui-kit/tokens.json:35
- 问题：generate-ui-tokens.cjs --check 退出 1。tokens.json 的两种主题均已有 iconOnDark/iconOnLight，但 tokens.css 未同步这 4 条声明；不是图标渲染失败，当前图标别名另有有效来源。
- 方案：下一阶段修复 Token 生成一致性并纳入 CI；不重画图标。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-002 P2

- 平台/页面：四端 / 全局尺寸/动效/层级
- 位置：scripts/generate-native-design.py:18; scripts/generate-ui-tokens.cjs:14; web/src/design-tokens.css:379
- 问题：原生生成器输出 palette / icon；Typography、Spacing、Radius、Component Height 仍手工映射。Web JSON zIndex 0…70 与实际 --z-modal=1000、--z-top=9999 等并行，motion easing/component 参数大量没有生成出口。
- 方案：补齐平台适配 Token 输出及有理由的例外；保留原生布局语义。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-003 P2

- 平台/页面：Web / Windows / 全局/聊天/资料
- 位置：web/src/main.jsx:8; web/src/ui-kit/foundation.css:12
- 问题：main 同时加载旧 design-tokens/index/skins/mobile-adapt 与 ui-kit；新版大量通过类选择器和 !important 覆盖旧实现。主流程已变新，但新增或遗漏控件仍可能回落旧值；私聊设置和 Danger 的实测即为例证。
- 方案：按组件迁移样式所有权；先列使用路径再逐步退役旧规则，不直接删除大文件。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-004 P2

- 平台/页面：四端 / 列表/资料/通话
- 位置：web/src/components/Avatar.jsx:24; web/src/ui-kit/tokens.json:241; ios/Touliao/Features/Profile/ProfileView.swift:14
- 问题：JSON avatar=24/32/44/64/88；Web AVATAR_TIERS=24/28/36/40/48/64/92；原生个人中心另有 66。没有角色到平台的明确映射。
- 方案：保留合理布局差异，统一 avatar role/size 合约，分离 profile、list、message。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-005 P2

- 平台/页面：Web / Windows / 文件列表/语音视频通话
- 位置：web/src/components/Avatar.jsx:33; web/src/components/ChatFiles.jsx:198; web/src/components/CallModal.jsx:1014; web/src/components/CallModal.jsx:901
- 问题：size="13" 与 size="88" 被当作未知 tier 回落 40；CallModal 的 display:block 传入 Avatar 后覆盖了内部居中 flex，使无头像来电的首字母偏到左上。
- 方案：明确数字与枚举类型校验，分离外容器 style 与头像内部 style。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-006 P2

- 平台/页面：四端 / 登录/注册/聊天/资料编辑
- 位置：ios/Touliao/UI/Theme/Theme.swift:75; android/app/src/main/java/com/touliao/app/feature/auth/RegisterScreen.kt:91; web/src/ui-kit/settings-media.css:41
- 问题：JSON input.radius=12；iOS TouliaoTextFieldStyle=8，Android 多处直接 OutlinedTextField；Web auth/input/edit/search 各有一组 CSS。Normal/Focused/Disabled/Error 的契约不共用。
- 方案：建立 Field + TextInput/Password/Search/ComposerInput 适配，输入框可有明确变体。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-008 P2

- 平台/页面：四端 / 登录/确认/群管理/设置
- 位置：web/src/ui-kit/foundation.css:144; web/src/ui-kit/people.css:36; ios/Touliao/UI/Components/VxinGradientButton.swift:4
- 问题：Web Primary 样式覆盖 wc-btn/auth-submit/gi-btn-save 等不同类族，缺统一 Button 组件；原生公共 VxinGradientButton 仅覆盖主按钮，其他变体由各页独立定义。
- 方案：建立 Primary/Secondary/Text/Danger/Icon/Call 的变体和 loading/disabled/pressed 合约；不强制合并业务回调。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-010 P2

- 平台/页面：Web（移动布局） / 通知/私聊设置/文件媒体预览/录音
- 位置：web/src/ui-kit/settings-media.css:16; web/src/components/FilePreview.jsx:337; web/src/components/VideoPreview.jsx:117; web/src/index.css:1076
- 问题：实测开关 44×26；文件返回约 32×32.7；视频关闭 36×36；语音按钮源高度 36。低于项目移动目标 44，不等同于所有控件违反 WCAG AA 24px 标准。
- 方案：扩展独立 hit area，保持图标几何和正常视觉大小不变。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-022 P2

- 平台/页面：Web / Windows / 群语音/视频通话
- 位置：web/src/components/GroupCallModal.css:2; web/src/components/GroupCallModal.css:18; web/src/ui-kit/settings-media.css:67
- 问题：GroupCallModal.css 仍用 #181922/#6553ba/#e94760、14px tile radius、48/56px 控件；1:1 通话由 ui-kit #18212d 和另一套控制样式管理。共享的是图标，通话组件整体尚未统一。
- 方案：保留固定深色媒体画布；建立 media surface/control/selected/danger Token 和 CallControl 变体。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-023 P2

- 平台/页面：iOS / Android / Web / Windows / 通话结束/恢复
- 位置：web/src/components/CallModal.jsx:769; ios/Touliao/Features/Call/CallView.swift:191; android/app/src/main/java/com/touliao/app/feature/call/CallScreen.kt:227; android/app/src/main/java/com/touliao/app/feature/call/CallScreen.kt:79
- 问题：Web 有 rejected/busy/timeout/network 文案映射；iOS ended 主要区分超时/断网；Android statusText(ENDED) 统一“通话结束”，800ms 自动消失。没有四端同一 UI 状态矩阵保证 Busy/Declined/Failed/Reconnecting 的可见反馈。
- 方案：先定义 UI 状态到现有客户端状态的映射和显示时长；不增加或修改信令协议。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-024 P2

- 平台/页面：四端 / 成功/错误/提示反馈
- 位置：web/src/utils/toast.jsx:24; ios/Touliao/UI/Components/Toast.swift:12; web/src/ui-kit/tokens.json:187
- 问题：JSON 默认 4000ms/action 8000/maxVisible2；Web 实际 info/success 3000、error4500+长度扩展且单条；iOS 2400ms、中性 Toast，同一 error Binding 还承载成功文案；Android 多处直接系统 Toast。
- 方案：统一业务反馈类型、可操作与阅读时长规则；允许 Android 系统呈现差异，不自行替换系统 Toast。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-025 P2

- 平台/页面：Web / Windows / 通讯录/搜索/文件/空列表
- 位置：web/src/components/StateViews.jsx:25; web/src/components/StateViews.jsx:38; web/src/components/ContactList.jsx:294
- 问题：StateViews 导出 EmptyState/ErrorState，但其他页面未引用它们；各页用 cl-empty/gs-empty/内联文案，有的含 CTA、说明，有的只一行文字。原生 EmptyState 也没有 action/error 变体。
- 方案：先定义 Empty/Error 的标题、说明、Retry/CTA 合约，再迁移已知页面，不强制全部使用同一插画。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-026 P2

- 平台/页面：Web / Windows / 聊天/异步面板/收藏
- 位置：web/src/components/StateViews.jsx:7; web/src/components/PanelSkeleton.jsx:27; web/src/components/PanelSkeleton.jsx:40
- 问题：StateViews.Skeleton 有 role=status/aria-busy，PanelSkeleton/ChatSkeleton 直接 div；骨架还用圆头像与34/42尺寸，而实际头像统一圆角方形及另一尺寸。
- 方案：共享 Skeleton primitives 与 accessibility 包装，按真实组件 geometry 配置。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-027 P2

- 平台/页面：四端 / 个人中心/设置/群信息
- 位置：ios/Touliao/Features/Profile/ProfileView.swift:16; android/app/src/main/java/com/touliao/app/feature/profile/ProfileScreen.kt:80; web/src/components/Profile.jsx:73; web/src/ui-kit/settings-media.css:12
- 问题：iOS Profile Tok.rowHeight=57、Android=56，Web wc-crow=64/移动68；各自 Card/SettingsRow/CRow/gi-row，缺 settings-cell 密度与间距 Token。不能将对话列表 68/76 直接强套到设置页。
- 方案：定义 SettingsCell/ProfileHeader/SectionCard 角色与平台 density 适配，复用页面结构。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-028 P2

- 平台/页面：四端 / 标题/正文/说明/动态字体
- 位置：ios/Touliao/UI/Theme/Theme.swift:43; android/app/src/main/java/com/touliao/app/ui/theme/Theme.kt:48; web/src/ui-kit/tokens.json:68
- 问题：JSON 有 6 级 size 和3级 line-height；iOS touliaoFont 的所有字号均按 body 缩放，并用 size<=16 推导行距；Android 有独立 titleSmall/headlineSmall=20 等表；Web 局部仍13/15/17等旧字号。没有统一语义 Text Style API。
- 方案：定义 Display/Title/Headline/Body/Secondary/Caption 到平台文本样式的映射；系统字体家族差异可保留。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-029 P2

- 平台/页面：四端 / Toast/弹窗/列表/骨架
- 位置：web/src/utils/toast.jsx:44; web/src/ui-kit/foundation.css:183; ios/Touliao/UI/Components/Toast.swift:30; ios/Touliao/UI/Components/MarqueeText.swift:11
- 问题：JSON 0/120/180/240ms；实际 CSS/内联存在100/150/200/220/250/300/350/400等，骨架1200规范与1300/1400/1800实现并存。Web 有全局 reduce 覆盖；iOS 仅 Marquee 显式读取减少动态效果，Toast 等应用动画没有统一入口。
- 方案：区分短交互/进度/持续装饰动效，生成时长/曲线 Token，并补原生减少动态效果验证。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

## DS-030 P3

- 平台/页面：四端 / 设计系统元数据
- 位置：web/src/ui-kit/tokens.json:5
- 问题：tokens.json status=proposed-design-standard，description=尚未映射到现有技术栈；与当前生成器及四端实际使用情况矛盾。
- 方案：更新版本/状态/负责人及合约文档，避免后续误认仍可任意修改。
- 验收：原问题定向自动测试、相关浅深色实际截图；原生变更由原生 build/test 验证；缺失证据单列待验证
- 风险：样式覆盖、原生单位/动态字体差异；仅改变展示层，保留回调/权限/协议。

