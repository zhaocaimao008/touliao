package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/**
 * 通话记录（GET /api/users/me/call-logs）。对齐 web CallHistory / 后端 getCallLogs。
 * direction: out=拨出 in=来电；status: completed/missed/canceled/rejected/ongoing。
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
    val peer_id: String = "",
    val peer_name: String = "",
    val peer_avatar: String = "",
)
