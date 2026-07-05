package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** GET /api/users/me/invite：我的专属邀请码 + 邀请战绩（裂变）。 */
@Serializable
data class InviteInfo(
    val code: String = "",
    val invitedCount: Int = 0,
    val invitees: List<Invitee> = emptyList(),
)

@Serializable
data class Invitee(
    val id: String = "",
    val username: String = "",
    val avatar: String = "",
    val wechat_id: String = "",
    val created_at: Long = 0,
)
