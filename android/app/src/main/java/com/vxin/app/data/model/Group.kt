package com.vxin.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class GroupMember(
    val id: String,
    val username: String = "",
    val avatar: String = "",
    val role: String = "member",      // owner | admin | member
    val nickname: String? = null,
) {
    val displayName: String get() = nickname?.takeIf { it.isNotBlank() } ?: username
}

/** GET conversation/{id}/info —— conv 字段 + members + myRole（Json 忽略未知字段） */
@Serializable
data class GroupInfo(
    val id: String,
    val name: String = "",
    val avatar: String = "",
    val owner_id: String = "",
    val myRole: String = "member",
    val members: List<GroupMember> = emptyList(),
) {
    val canManage: Boolean get() = myRole == "owner" || myRole == "admin"
}

@Serializable
data class RenameGroupBody(val name: String)

@Serializable
data class InviteBody(val userIds: List<String>)
