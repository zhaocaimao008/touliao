package com.touliao.app.core.push

import com.touliao.app.core.call.CallIntents
import com.touliao.app.core.realtime.GroupCallInviteEvent

/**
 * 群通话邀请推送（type=group_call_invite）的纯解析（纯 Kotlin，不引用 android.* / org.json，便于 JVM 单测）。
 * 后端字段见 push.js pushGroupCallInvite（FCM data-only）/ getuiPush.pushGroupCallInviteToCid（个推透传与厂商通道 intent）。
 */
object GroupCallInvitePush {
    const val TYPE = "group_call_invite"

    data class Parsed(val recipientId: String, val event: GroupCallInviteEvent, val groupName: String)

    /**
     * [get] 取字段：FCM 传 { data[it] }，个推传 { json.optString(it).takeIf { v -> v.isNotEmpty() } }，
     * 厂商通道传 { intent.getStringExtra(vendorExtraKey(it)) }。
     * 必须有 recipientId、callId、conversationId，expiresAt 为正的毫秒时间戳，且发起人不是收件人；否则返回 null，调用方什么都不显示。
     */
    fun parse(get: (String) -> String?): Parsed? {
        val recipient = get("recipientId").orEmpty()
        val callId = get("callId").orEmpty()
        val conv = get("conversationId").orEmpty()
        val fromId = get("fromId").orEmpty()
        val expiresAt = get("expiresAt")?.toLongOrNull() ?: 0L
        // 缺 expiresAt 视为无效：防迟到推送按 60s 兜底复活旧邀请；fromId==recipient：冷启动时 currentUser 可能还没就绪，
        // 协调器"发起人是自己"的过滤会失效，这里先挡一次
        if (recipient.isEmpty() || callId.isEmpty() || conv.isEmpty() || expiresAt <= 0L || fromId == recipient) return null
        val type = if (get("callType") == "video") "video" else "audio"
        return Parsed(
            recipient,
            GroupCallInviteEvent(callId, conv, type, fromId, get("fromName").orEmpty(), "", expiresAt),
            get("groupName").orEmpty(),
        )
    }

    /** 个推厂商通道 intent 的 extra 键（与后端 intent 字符串逐字一致）；recipientId/conversationId 与消息通知同名 */
    fun vendorExtraKey(field: String): String = when (field) {
        "callId" -> CallIntents.EXTRA_GROUP_CALL_ID
        "callType" -> CallIntents.EXTRA_GROUP_CALL_TYPE
        "fromId" -> CallIntents.EXTRA_GROUP_CALL_FROM_ID
        "fromName" -> CallIntents.EXTRA_GROUP_CALL_FROM_NAME
        "expiresAt" -> CallIntents.EXTRA_GROUP_INVITE_EXPIRES_AT
        else -> field
    }
}
