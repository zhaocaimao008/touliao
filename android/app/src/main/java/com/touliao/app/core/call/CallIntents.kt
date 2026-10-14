package com.touliao.app.core.call

/**
 * 通话相关的 Intent action / extra 键、通知 id、渠道 id 与 PendingIntent 请求码（跨包契约 C1）。
 * 名字和值是 CallActivity、NotificationHelper、CallActionReceiver、CallForegroundService 之间的约定，不得改动。
 */
object CallIntents {
    // ── Action ──
    const val ACTION_CALL_SHOW = "com.touliao.app.action.CALL_SHOW"
    const val ACTION_CALL_ACCEPT = "com.touliao.app.action.CALL_ACCEPT"
    const val ACTION_CALL_DECLINE = "com.touliao.app.action.CALL_DECLINE"
    const val ACTION_CALL_RESUME = "com.touliao.app.action.CALL_RESUME"
    const val ACTION_CALL_HANGUP = "com.touliao.app.action.CALL_HANGUP"
    const val ACTION_GROUP_CALL_JOIN = "com.touliao.app.action.GROUP_CALL_JOIN"
    const val ACTION_GROUP_CALL_INVITE_DISMISS = "com.touliao.app.action.GROUP_CALL_INVITE_DISMISS"

    // ── Extra ──
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALL_FROM = "callFrom"
    const val EXTRA_CALL_NAME = "callerName"
    const val EXTRA_CALL_TYPE = "callType"
    const val EXTRA_RECIPIENT_ID = "recipientId"
    const val EXTRA_CONVERSATION_ID = "conversationId"
    const val EXTRA_CALL_KIND = "callKind"
    const val KIND_P2P = "p2p"
    const val KIND_GROUP = "group"
    const val EXTRA_GROUP_CALL_ID = "groupCallId"
    const val EXTRA_GROUP_CONVERSATION_ID = "groupConversationId"
    /** 取值 "audio" 或 "video" */
    const val EXTRA_GROUP_CALL_TYPE = "groupCallType"
    /** Long：邀请截止时刻，按本机 System.currentTimeMillis() 计 */
    const val EXTRA_GROUP_INVITE_DEADLINE = "groupInviteDeadline"

    // ── 通知 id、渠道 id 与请求码 ──
    const val CALL_NOTIFICATION_ID = 424242
    const val ONGOING_CALL_NOTIFICATION_ID = 424243
    const val GROUP_CALL_INVITE_NOTIFICATION_ID = 424244
    const val CALL_CHANNEL_ID = "vxin_calls"
    const val CALL_ONGOING_CHANNEL_ID = "vxin_call_ongoing"
    const val GROUP_CALL_INVITE_CHANNEL_ID = "vxin_group_call_invite"
    const val REQ_ONGOING_RESUME = 424250
    const val REQ_ONGOING_HANGUP = 424251
}
