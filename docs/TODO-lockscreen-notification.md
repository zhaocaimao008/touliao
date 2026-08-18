# 投聊 锁屏通知优化 TODO

_来源: #15581 锁屏通知验收静态审计（2026-08-18）| 状态: 计划中 | 归属: AI_DEV_TEAM_

> 全部优化均有 vxin 母版现成实现可参照（/root/vxin-1.0）。本轮为计划阶段，尚未改码。

## 🔴 高优先级（发布前必须修）

| # | Task ID | 级别 | 问题 | 修复方向 | 参照实现 |
|---|---------|------|------|----------|----------|
| 1 | NOTIFY-001 | P1 | Android 点击通知只打开首页，不进正确会话（NotificationHelper 写入 EXTRA_CONVERSATION_ID 但 MainActivity 无消费点） | 移植 vxin 的 `PendingConversationHolder` 机制：MainActivity.handleMessageIntent → holder → AppNavigation LaunchedEffect 冷启动也消费，`removeExtra` 只消费一次 | vxin MainActivity.kt handleMessageIntent + PendingConversationHolder |
| 2 | NOTIFY-002 | P1 | 通知无聚合/未读数：同会话连发 10 条只显示最后一条（id=conversationId.hashCode() 覆盖）；无 setNumber 角标；进会话不清除旧通知 | NotificationHelper 加 InboxStyle 聚合（最多 5 条预览）+ setNumber(未读数) + clearConversationNotifications（进会话时清除该会话通知） | vxin NotificationHelper.kt |
| 3 | NOTIFY-003 | P2 | iOS 来电通知无接听/拒绝按钮（未注册 UNNotificationCategory） | AppDelegate 注册 `INCOMING_CALL` category（ANSWER/DECLINE actions），didReceive response 分发 | vxin AppDelegate.swift |
| 4 | NOTIFY-004 | P2 | 通知 smallIcon 用系统默认图标（ic_dialog_email / ic_menu_call），状态栏/锁屏无品牌辨识 | 换品牌透明 PNG smallIcon（投聊资源），来电换品牌电话图标 | 投聊 res/drawable |

## 🟡 中优先级（下个版本）

| # | Task ID | 级别 | 问题 | 修复方向 |
|---|---------|------|------|----------|
| 5 | NOTIFY-005 | P2 | 群聊通知不显示群名（标题=发送者、body=正文，锁屏看不出是哪个群） | 后端 push.js 群消息标题用群名，body 前缀「发送者: 内容」 |
| 6 | NOTIFY-006 | P2 | iOS badge 无清零逻辑（角标由 APNs payload badge 驱动，客户端无 setBadgeCount(0)） | 进会话/回前台时 `UIApplication.shared.applicationIconBadgeNumber = 0`（对齐 Android clearConversationNotifications） |
| 7 | NOTIFY-007 | P2 | 好友申请不走系统通知（仅站内展示；notificationTemplate.js 有 friend_request 模板但无调用点） | 后端 friends 模块加 pushToUser 触发（若产品需要锁屏提醒） |

## 🟢 低优先级（二期）

| # | Task ID | 级别 | 问题 | 修复方向 |
|---|---------|------|------|----------|
| 8 | NOTIFY-008 | P3 | 国产 ROM 后台限制：FCM 国内不可用、GeTui 透传被华为/小米后台限制时收不到 | 接个推厂商通道或 HMS Push/小米推送 |
| 9 | NOTIFY-009 | P3 | @提醒无独立推送分支 | 后端群消息扫 @用户名 → 被@者高优先级通知（震动+特殊声音） |
| 10 | NOTIFY-010 | P3 | 隐私模式不彻底：detail_preview 关时 body 模糊但标题仍显示发送者名 | 标题也模糊（"新消息"），Android 配合 VISIBILITY_PRIVATE |

## 执行顺序
1→2→3→4（发布前，均参照 vxin 已有实现，工作量小）→ 5→6→7（下版本）→ 8→9→10（二期）

## 约束
- 每个任务独立 Task ID / Branch / Worktree（AI_DEV_TEAM 规则）
- P1 任务（NOTIFY-001/002）走完整流程：Claude 诊断 → 修改 → 测试 → Codex Review → Hermes 复核 → Claude 最终验收 → awaiting_approval
- 投聊主仓库未提交改动（desktop-electron/package-lock.json、web/package-lock.json）必须保留不动
- 禁止修改已验证的 AI 基础设施
