# 投聊四端差异审计

## 发布阻断差异

1. Android 没有 Web/iOS 等价的 Socket reconnect catch-up。网络恢复只重连 socket，不主动补当前会话缺口。
2. iOS 没有 Web/Android 的 `new_message_notify` 消费逻辑。服务端对在线连接数超过 500 的房间只发轻通知，iOS 因此不能实时补取消息。
3. 后端会给呼叫方同账号其他设备发送 `call:outgoing`，Web/Android/iOS 均未发现监听；Windows继承 Web 缺口。
4. Web/Windows 有完整 PDF/Office 内置预览包；移动端存在预览/下载视图，但格式、系统组件和失败降级需要真机逐格式验证。
5. Web 有 39 条跨上下文 E2E；Android 只有消息移除/缓存少量单测，iOS 只有缓存测试，证据级别严重不对齐。

## 入口与状态差异

| 项目 | Web/Windows | Android | iOS |
|---|---|---|---|
| 重连状态 | banner + reconnectCount + 当前会话增量拉取 | socket 状态，无补拉事件 | reconnected publisher + 当前历史重载 |
| 超大群 | notify 后增量拉取 | notify 后增量拉取 | 无监听 |
| 失败消息 | 5 秒失败态 + localStorage outbox | 本地 outbox/pending UI | 本地 outbox/pending UI |
| 文件预览 | PDF.js/docx/xlsx 内置 | Compose overlay/系统能力组合 | SwiftUI/QuickLook/AVFoundation 组合 |
| 通话多设备 | 处理 incoming/end，缺 outgoing | 同左 | 同左 |
| 桌面能力 | Electron 通知、更新、休眠事件 | 不适用 | 不适用 |

## 建议的对齐契约

- 同一 `SyncCursor { conversation_id, last_sequence }`，四端连接成功后都执行 catch-up。
- `new_message`、`new_message_batch`、`new_message_notify` 最终都进入同一 dedup/merge reducer。
- 通话增加显式 `callId + revision + state`，所有同账号设备订阅相同状态，不以单个事件猜状态。
- 附件统一 `message_type/attachment_id/mime_type/file_size/duration/thumbnail/storage_key` DTO；目前主要依赖 `file_url/file_mime/file_size/duration`，缺少稳定 attachment 实体契约。
- 每个功能的入口名称、权限错误文案和 loading/empty/error 状态纳入共享验收表。
