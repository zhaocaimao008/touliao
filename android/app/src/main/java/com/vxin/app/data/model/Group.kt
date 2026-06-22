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
    val announcement: String = "",
    val owner_id: String = "",
    val myRole: String = "member",
    val members: List<GroupMember> = emptyList(),
) {
    val canManage: Boolean get() = myRole == "owner" || myRole == "admin"
    fun myNickname(myId: String): String = members.firstOrNull { it.id == myId }?.nickname.orEmpty()
}

@Serializable
data class RenameGroupBody(val name: String)

/** 更新群信息（群名 / 群公告，仅群主、管理员） */
@Serializable
data class UpdateGroupBody(val name: String? = null, val announcement: String? = null)

/** 设置我的群昵称 */
@Serializable
data class NicknameBody(val nickname: String)

@Serializable
data class InviteBody(val userIds: List<String>)
