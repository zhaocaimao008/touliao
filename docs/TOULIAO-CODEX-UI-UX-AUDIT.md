# 投聊 UI/UX 审计

## 总结

总体 `PARTIAL`，评分 75/100。Web 已有设计 token、虚拟消息列表、骨架屏、空/错状态、焦点捕获与响应式样式，明显不是简单后台模板。39 条真实浏览器 E2E 覆盖了登录、会话、好友申请、群聊、灯箱、输入法、弱网提示和通话弹窗。但本轮没有四端真实设备截图矩阵，不能给 `REAL_DEVICE_PASS`。

## 发现

- P1：多设备呼出通话没有客户端 UI 状态入口，其他设备表现为空白或仍停留旧状态。
- P2：Web 虚拟列表下 EDGE-06 全套运行时未能看到失败气泡，隔离运行正常；需用 trace 核对自动贴底与共享历史高度，而不是扩大 timeout。
- P2：Android `ProfileScreen`、`SettingsHomeScreen` 的 `updateState` 未使用，可能意味着更新状态提示没有接入 UI。
- P2：Android Manifest 有 `tools:replace` 无目标声明警告，配置意图与实际合并不一致。
- P2：iOS/Android 文件“不支持预览”降级仍允许跳系统应用；对“不要自动跳浏览器”的要求需逐格式真机确认。
- P2：Web A11Y 文档仍记录 Profile 修改昵称输入仅 placeholder、缺正式 label，需重新跑 axe 验证是否仍存在。
- P3：Web 大型 `ChatWindow.jsx`/`Home.jsx` 聚合过多状态，增加重复 listener、切会话状态串扰和 UI 回归风险。
- P3：Windows 和 Web 共用 UI 是优点，但桌面标题栏、缩放、窗口最小尺寸、系统通知和高 DPI 尚无截图基线。

## 必测视口/设备

- Web：320、768、1024、1440 px；长文本、100+ 消息、附件面板、好友申请弹层。
- Android：小屏、刘海屏、横屏、软键盘、后台返回；TalkBack。
- iOS：SE/标准/Max，Safe Area、Dynamic Type、键盘、听筒/蓝牙；VoiceOver。
- Windows：100/125/150/200% 缩放，多显示器，窗口最小化/休眠恢复。

## 页面结论

聊天页 `PARTIAL`；好友申请 Web `RUNTIME_PASS`、移动端 `REAL_DEVICE_REQUIRED`；群资料 `CODE_PASS`；通话页 Web 信令 `RUNTIME_PASS`、四端媒体 `REAL_DEVICE_REQUIRED`；附件预览 Web `RUNTIME_PASS`、移动端跨格式 `REAL_DEVICE_REQUIRED`。
