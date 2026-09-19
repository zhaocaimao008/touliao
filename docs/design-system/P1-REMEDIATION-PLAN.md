# P1 REMEDIATION PLAN

分支：`ui/design-system-p1-20260919`。Checkpoint：`checkpoint/design-system-before-p1-20260919`，提交 `53f76859d15590cb26edc48340a6639353a034b9`。

完整报告与 findings.csv 已读取。以下为实际 10 个 P1，全部落在 Web / Windows 共用 UI。原生组件保留；只核对/验证适配，不把 P2 原生改造扩大到本轮。禁止发布及修改图标、服务端、协议与生产配置。

## DS-011 · 确认框未管理模态键盘焦点

- 页面：删除聊天记录/共用确认框
- 平台：Web / Windows
- 当前问题：打开确认框后焦点停留在背景删除按钮；连续 Tab 进入背景聊天工具栏，Esc 不关闭。aria-modal=true 并未落实实际模态行为。
- 当前实现：web/src/utils/toast.jsx:48
- 公共组件：TouliaoDialog / useFocusTrap
- 修改方案：共享可嵌套模态焦点；初始取消按钮、Esc、Tab 循环和恢复；showConfirm Promise 接口保持
- 风险：嵌套模态和卸载后焦点恢复
- 验证：四主题/布局验证 Tab/ShiftTab/Esc/取消/确认及嵌套焦点

## DS-012 · 媒体文件模态缺少焦点约束

- 页面：文件/图片/视频预览
- 平台：Web / Windows
- 当前问题：文件下载按钮后按 Tab 会进入 BODY、skip-link、背景返回按钮；FilePreview 有 Esc，但没有 trap。Image/VideoPreview 同样独立处理窗口键盘事件而未复用模态焦点合约。
- 当前实现：web/src/components/FilePreview.jsx:300; web/src/components/VideoPreview.jsx:25; web/src/components/ImagePreview.jsx:17
- 公共组件：useFocusTrap / 媒体 Dialog 合约
- 修改方案：文件、图片、视频预览接入同一焦点基础；保留原生媒体控制
- 风险：视频原生控件与嵌套预览键盘冲突
- 验证：三类预览逐项 Tab/ShiftTab/Esc/恢复；下载/播放既有测试

## DS-014 · 移动私聊设置挤压聊天区

- 页面：单聊 → 更多/聊天设置
- 平台：Web
- 当前问题：390px 宽时设置面板仍固定占用 240px 横向列，聊天区只剩约 150px，消息逐字换行；群资料已有小屏覆盖规则，私聊设置未接入。
- 当前实现：web/src/components/ChatWindow.css:851; web/src/ui-kit/people.css:54
- 公共组件：SettingSection / 响应式设置面板
- 修改方案：小屏覆盖式面板、可滚动内容、关闭入口，宽屏保留侧栏
- 风险：窗口 resize 和安全区
- 验证：320/390/900/1200 布局测量和截图

## DS-015 · 语音模式与 Emoji 面板同时激活

- 页面：聊天输入区
- 平台：Web / Windows
- 当前问题：点击 Emoji 后切换语音，emoji 和 voice 同时为 true，两个“切换键盘”入口同时高亮，下方保留小型“按住说话”。activePanel 只约束 Emoji/stickers/more，未包含 voice。
- 当前实现：web/src/components/ChatWindow.jsx:229; web/src/components/ChatWindow.jsx:2835
- 公共组件：Composer 展示模式 reducer
- 修改方案：TEXT/KEYBOARD/VOICE/EMOJI/MORE 互斥；stickers 作为附件面板子态；发送与录音传输不动
- 风险：IME、草稿、录音切换
- 验证：转换表单元测试；连续切换、IME、发送清空、resize 浏览器测试

## DS-016 · 极长文件名遮挡文件详情内容

- 页面：文件详情
- 平台：Web / Windows renderer
- 当前问题：320×568、208 字符文件名时，居中的绝对定位内容超出可用区域，说明文字被挤掉/裁切；页面无横向滚动并不能证明内部布局正确。
- 当前实现：web/src/components/FilePreview.jsx:374; web/src/components/FilePreview.jsx:377
- 公共组件：FilePreview / FileDetails
- 修改方案：可滚动详情、可换行文件名、固定可达操作栏；统一语义样式
- 风险：文档渲染器高度
- 验证：320×568 长中文/无后缀/未知格式及大文件截图与 DOM 可达性

## DS-017 · 聊天文件界面显示翻译 key

- 页面：聊天文件
- 平台：Web / Windows
- 当前问题：tabAll/tabImage/tabVideo/tabFile/countTemplate/noFiles/openFileAriaLabelTemplate 等 7 个键缺少字典值；实际 Tab 显示 chatFiles.tabAll 等，并占满窄屏。
- 当前实现：web/src/components/ChatFiles.jsx:20; web/src/contexts/I18nContext.jsx:1184
- 公共组件：ChatFiles / I18n
- 修改方案：补齐全部三语缺失键；文件 aria label 使用真实字段
- 风险：翻译 fallback
- 验证：三语键完整性测试和实际渲染检查

## DS-018 · 文件加载失败没有 Error/Retry 状态

- 页面：聊天文件
- 平台：Web / Windows
- 当前问题：注入 HTTP 500 后两种布局 6 秒内各发起 6 次请求，仍显示“加载中…”；catch 静默，没有错误组件或用户重试入口。不能把失败归为正常 Empty。
- 当前实现：web/src/components/ChatFiles.jsx:63; web/src/components/ChatFiles.jsx:79
- 公共组件：File Row / ErrorState / Loading
- 修改方案：显式 loading/empty/error 状态；失败停止观察器自动重试；人工重试；隔离过期响应
- 风险：换 tab/会话时旧响应覆盖、分页重复
- 验证：HTTP500请求次数、重试恢复、分页、切 tab 竞态

## DS-019 · 旧 Danger 颜色未完整适配深色

- 页面：私聊设置/删除文字
- 平台：Web / Windows
- 当前问题：私聊删除仍用 --color-badge：Web 浅色 #FA5151/白=3.30:1，深色同色/#202B3A=4.33:1；Windows 深色 #BD3048/#202B3A=2.51:1。普通大小文字低于 4.5:1。
- 当前实现：web/src/components/ChatWindow.css:948; web/src/design-tokens.css:86; web/src/windows-desktop.css:15
- 公共组件：语义 Danger token / DangerButton
- 修改方案：私聊删除文字使用 readableDanger，确认按钮表达危险意图
- 风险：旧 CSS 优先级
- 验证：Light/Dark × Web/Windows 实测对比度 ≥4.5

## DS-020 · 私聊开关缺少无障碍名称

- 页面：私聊设置
- 平台：Web / Windows
- 当前问题：浏览器 AX 树两个 switch 的 name 均为空；屏幕阅读器可读到开/关，但无法区分免打扰和置顶；旁边 span 并未建立标签关联。
- 当前实现：web/src/components/PrivateChatSettings.jsx:80; web/src/components/PrivateChatSettings.jsx:89
- 公共组件：TouliaoSwitch / SettingCell
- 修改方案：统一三套 Switch 外壳、可访问名称、saving disabled、44点击区，保留页面业务回调
- 风险：回调重复或 disabled 不生效
- 验证：AX name/checked/disabled、鼠标键盘操作、保存期间禁用

## DS-021 · 消息菜单未提供完整键盘导航

- 页面：消息右键/长按菜单
- 平台：Web / Windows
- 当前问题：右键打开后焦点仍为 body；ArrowDown 不进入菜单。条目支持 Enter/Space，容器支持 Esc，但没有初始焦点与方向键导航。
- 当前实现：web/src/components/ChatWindow.jsx:79; web/src/components/ChatWindow.jsx:3030
- 公共组件：MessageActionMenu
- 修改方案：抽出菜单呈现层，初始焦点、上下/Home/End、Esc/Tab 关闭和焦点恢复；保持动作顺序
- 风险：位置 clamp 与新弹窗焦点争抢
- 验证：键盘全路径、操作回调、窄屏菜单边界、既有 CtxPos 测试

## 范围与执行次序

文件和焦点基础 → 设置和 Switch → Composer/Menu → Dialog 调用迁移与基础 Button/Field → 回归。复用现有 ErrorState/EmptyState/Toast，禁止新增另一套反馈库。其余 P2/P3 保留后续，不将搭建入口组件视为全量迁移完成。

验证证据区分本轮执行、同源历史 CI、Linux renderer 与原生设备。所有未真机执行项目标注 NOT_DEVICE_VERIFIED。
