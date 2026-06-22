package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 好友 —— GET /api/users/contacts */
@Serializable
data class Contact(
    val id: String,
    val username: String = "",
    val avatar: String = "",
    val bio: String = "",
    val status: String = "",
    val wechat_id: String = "",
    val remark: String? = null,
) {
    val displayName: String get() = remark?.takeIf { it.isNotBlank() } ?: username
}

/** 搜索结果用户 —— GET /api/users/search */
@Serializable
data class SearchUser(
    val id: String,
    val username: String = "",
    val avatar: String = "",
    val bio: String = "",
    val wechat_id: String = "",
)

/** 收到的好友申请 —— GET /api/users/friend-requests */
@Serializable
data class FriendRequest(
    val id: String,
    val from_id: String = "",
    val message: String = "",
    val status: String = "",
    val created_at: Long = 0,
    val username: String = "",
    val avatar: String = "",
    val wechat_id: String = "",
)

@Serializable
data class FriendRequestBody(val toId: String, val message: String = "")

/** 已发送的好友申请（GET friend-requests/sent） */
@Serializable
data class SentRequest(
    val id: String,
    val status: String = "",        // pending | accepted | rejected
    val message: String = "",
    val created_at: Long = 0,
    val toId: String = "",
    val username: String = "",
    val avatar: String = "",
    val wechat_id: String = "",
)

@Serializable
data class RemarkBody(val remark: String)

@Serializable
data class BlockedUser(
    val id: String,
    val username: String = "",
    val avatar: String = "",
)

@Serializable
data class HandleRequestBody(val action: String)   // accept | reject

@Serializable
data class SendRequestResponse(val success: Boolean = false, val autoAccepted: Boolean = false)

@Serializable
data class CreatePrivateBody(val userId: String)

@Serializable
data class CreateGroupBody(val name: String, val memberIds: List<String>)

@Serializable
data class CreateConversationResponse(val conversationId: String, val groupNumber: String? = null)
