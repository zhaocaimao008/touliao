# 投聊 UI 设计系统交付报告

## 交付范围

本轮在独立分支 `ui/design-system-20260918` 改造 Web／Windows 共用 React 界面，未部署、未发版、未推送远端。Android、iOS 原生工程及 Electron 主进程未改动；后端、接口、WebSocket 协议、数据结构与认证／通话处理逻辑保留。

设计来自已授权本地文件 `/home/ubuntu/touliao-ui.zip`，内部内容与所要求的设计包匹配，独立解压到 `/home/ubuntu/design-reference/touliao-ui-20260918/touliao-ui/`。七份交接文档已读取，index.html 已实际打开，提供的预览图已查看。交接中的 Claude 实施角色由本轮承担。

原 main 和 Windows 工作区均保持干净。隔离工作区：`/home/ubuntu/touliao-design-system-20260918`；恢复基点：`1bd57c012ee830fbd66692f0ce7ff96aac84ed1e`。

## 修改清单

| 批次 | 实际修改 | 本地提交 |
| --- | --- | --- |
| 1 基础 | 原始 tokens、可校验 CSS 生成器、136 个 SVG、公共图标适配、字体与语义颜色、基础控件；保留旧皮肤偏好 | `aa740615` |
| 2 会话／聊天 | 导航及双栏尺寸、真实会话筛选、虚拟行高、气泡、输入工具栏、窄屏布局、主按钮和文字对比度、清除旧版暗色气泡光晕 | `755aac1b` |
| 3 联系人／群 | 通讯录完整工作区、好友与资料卡、标签、群选择／资料／权限面板、搜索 | `b4f551b7` |
| 4 设置／媒体 | 资料、设备、隐私、外观、通知、密码、登录／注册／找回、会话文件、来电和通话控制图标 | `31b8d322` |
| 5 内容／回归 | 朋友圈、收藏、上传与断网错误、骨架和角标、深色 Windows 字体；消息状态更新时保留虚拟行高和待执行滚动任务，计入窄屏行间距；对照图库及交付文档 | 本报告所在提交 |

源代码主要位于 `web/src/ui-kit/`、既有 `components/` 与 `pages/`。测试 fixture 仅在 `scripts/`，没有把原型数据或演示成功提示写入正式应用。已有钱包、AI、邀请等功能继续保留，未添加新业务。

42 页、66 类组件与 30 条动作契约的逐项对应分别见 [页面映射](page-mapping.csv)、[组件映射](component-mapping.csv)、[动作映射](action-mapping.csv)。这里的“适配”包括复用现有路由、抽屉和弹窗，不代表新造了 42 个独立路由或完成全部平台迁移。

## 验证与截图

最终机器可读结果：`/home/ubuntu/touliao-design-system-evidence-20260918/validation-summary.json`。

| 检查 | 结果／证据 |
| --- | --- |
| 桌面、Web 两种 Vite 构建 | 均通过；`final-desktop-build.log`、`final-web-build.log` |
| ESLint、现有单测 | lint 无警告；33 个文件／240 项单测通过 |
| tokens 生成一致性、Git diff 格式、映射路径 | 全部通过；42／66／30 清单路径有效，136 个图标齐全 |
| 会话／聊天／基础布局 | 48 场景通过；`final-core/report.json` |
| 联系人／群／搜索 | 56 场景通过；`final-people/report.json` |
| 资料／设置／认证／文件／来电 | 68 场景通过；`final-settings/report.json` |
| 内容／异常／长会话 | 62 场景通过；`batch5/report.json` |
| 四种皮肤、系统主题、字体和缩放 | 96 场景通过；`final-themes/report.json` |
| 既有 Windows 窗口与布局冒烟 | 37 场景通过；`final-windows/metrics.json` |
| Web 构建渲染与交互 | 48 场景通过；`final-web/report.json` |

Windows 冒烟中的 `unchanged-web/darwin/linux` 名称沿用既有脚本，仅表示 Windows 专属样式未加载到其他平台；Web 共享 UI 本轮确有变化。

截图检查覆盖浅色、深色、桌面和 390px 窄屏；核心布局另测 900px 紧凑桌面。检查页面溢出、虚拟列表重叠、输入框可见、主题色、关键文字／表单对比度及 Windows 字体栈。媒体画面和禁用控件等不以普通正文标准强行改色。

关键交互在真实 React 组件上运行、由隔离 API／WebSocket 接收：中文输入法 Enter 不误发、Shift+Enter 换行、剪贴板文本、发送确认、失败重试沿用 clientMsgId、120 条历史中的阅读位置、拖放上传失败后重试、录音权限拒绝、断网提示、通知设置 PUT、设备下线 DELETE、好友申请 POST、来电拒绝事件和文本文件预览。保留既有乐观发送行为，未改成“等回执后才清空输入”。

打开 `/home/ubuntu/touliao-design-system-evidence-20260918/review.html` 可按页面、主题、布局切换改造前／改造后／设计参考。`reference/` 有 42 × 2 × 2 共 168 张实际原型截图；`before/`、`before-journeys/`、`before-settings/`、`before-content/` 保留旧版截图。旧版深层内容回归在长会话发送检查处失败，不能把该基线运行称为全通过；已保存的前图仍可用于视觉对照。没有对应实现或截图的项目在图库明确说明。

## 设计取舍与未完成事项

- tokens 与原型局部 CSS 尺寸冲突时，以 tokens 为准；原始 JSON 保持不变。原浅色辅助／错误文字在部分底色上未达到规范对比度，使用文字专用衍生色修正。
- 旧版皮肤与字体偏好继续生效；新增默认“投聊蓝”。使用系统字体栈，没有把字体文件打包。保留实际品牌位图与认证页的真实服务器／账号入口。
- 缺少已核实协议的扫码认证、短信验证码和未登录自助重置、独立入群申请审批、存储统计、反馈提交、全局文件中心列为待接入，未制造假按钮。既有管理员协助找回、已登录改密、群邀请、会话文件等继续可用。
- 链接元信息卡、全局撤销提示、上传手动暂停／恢复入口仍待产品和协议接入；既有分片上传与恢复机制保留。
- 视频播放、音视频设备选择、部分文件预览工具栏和媒体滑块沿用现有组件与语义变量，未重写所有媒体控件为原型外观。PDF／Office／视频等完整格式矩阵和真机媒体效果尚未验收。
- 本次环境为 Linux Chromium，Windows 桥接为 fixture；不是原生 Windows 验收。实际 Segoe UI／微软雅黑渲染、125%／150% 系统 DPI、真实 Electron 安装更新、双人音视频连通和服务端成功／失败全链路仍需对应环境联测。浏览器缩放、视口和 CSS 字体栈检查不能替代这些项目。
- 窄屏截图属于 Web，不是 Android／iOS 原生。按先前范围保留原生端不动，技术栈和页面路径已核对，后续迁移与真机测试单列。

## 回退与继续开发

生产、原工作区及旧版安装包没有变化，无需生产回退。审阅恢复点可另建工作区：

```bash
git -C /home/ubuntu/gh-mirror/touliao worktree add --detach /home/ubuntu/touliao-ui-baseline-review 1bd57c012ee830fbd66692f0ce7ff96aac84ed1e
```

如以后合并本轮提交，需要代码回退时先保存届时的未提交改动，再按从新到旧逐条 `git revert` 本轮五个提交。可用下式取得清单，避免误回退其他提交：

```bash
git log --format='%h %s' 1bd57c012ee830fbd66692f0ce7ff96aac84ed1e..ui/design-system-20260918
```

不执行全局 reset／clean。运行环境与命令见 [实施记录](README.md#重现验证)。
