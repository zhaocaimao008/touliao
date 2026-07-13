package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 好友标签（含成员简表）。 */
@Serializable
data class FriendLabel(
    val id: String = "",
    val name: String = "",
    val color: String = "#07C160",
    val members: List<LabelMember> = emptyList(),
)

@Serializable
data class LabelMember(
    val id: String = "",
    val username: String = "",
    val avatar: String = "",
)

@Serializable
data class FriendLabelBody(val name: String, val color: String? = null)

@Serializable
data class FriendLabelMemberBody(val friendId: String)
