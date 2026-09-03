package com.touliao.app.data.model

import kotlinx.serialization.Serializable

/**
 * 通话记录（GET /api/users/me/call-logs）。对齐 web CallHistory / 后端 getCallLogs。
 * direction: out=拨出 in=来电；status: completed/missed/canceled/rejected/ongoing。
 * kind: "private"(1对1，peer_id 有值) | "group"(群通话，peer_id 为 null，peer_name/
 * peer_avatar 复用为群名/群头像，conversation_id/participant_count 才有值)。
 */
@Serializable
data class CallLog(
    val id: String,
    val type: String = "audio",       // audio | video
    val status: String = "completed", // completed | missed | canceled | rejected | ongoing
    val direction: String = "out",    // out | in
    val duration: Int = 0,            // 秒
    val started_at: Long = 0,
    val ended_at: Long = 0,
    val created_at: Long = 0,
    val kind: String = "private",     // private | group
    val peer_id: String? = null,
    val peer_name: String = "",
    val peer_avatar: String = "",
    val conversation_id: String? = null,
    val participant_count: Int? = null,
)
