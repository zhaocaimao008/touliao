package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 会话列表项 —— 对齐后端 listConversations 返回 */
@Serializable
data class Conversation(
    val id: String,
    val type: String = "private",           // private | group | filehelper
    val name: String = "",
    val avatar: String = "",
    val lastMessage: String? = null,
    val lastMessageType: String? = null,
    val lastTime: Long? = null,             // epoch 秒
    val lastSenderName: String? = null,
    val unreadCount: Int = 0,
    val pinned: Int = 0,
    val muted: Int = 0,
)

@Serializable
data class MarkReadRequest(val messageId: String? = null)

/** 消息 —— REST history 与 Socket new_message 共用同一结构 */
@Serializable
data class Message(
    val id: String,
    val conversation_id: String,
    val sender_id: String,
    val type: String = "text",              // text | image | voice | file | video | ...
    val content: String = "",
    val file_url: String = "",
    val reply_to_id: String? = null,
    val created_at: Long = 0,               // epoch 秒
    val senderName: String = "",
    val senderAvatar: String = "",
    val reactions: List<MessageReaction> = emptyList(),
    val replyTo: ReplyPreview? = null,
)

@Serializable
data class MessageReaction(val emoji: String = "", val count: Int = 0)

/** 被回复消息的摘要(后端 history/new_message 的 replyTo 字段) */
@Serializable
data class ReplyPreview(
    val id: String = "",
    val type: String = "text",
    val content: String = "",
    val senderName: String = "",
)

@Serializable
data class DeleteMessageBody(val forEveryone: Boolean = true)

@Serializable
data class ReactBody(val emoji: String)

@Serializable
data class ReactResponse(val reactions: List<MessageReaction> = emptyList())

@Serializable
data class PinMessageBody(val msgId: String)

/** 群置顶消息（GET .../pinned-messages） */
@Serializable
data class PinnedMessage(
    val msgId: String = "",
    val type: String = "text",
    val content: String = "",
    val file_url: String = "",
    val senderName: String = "",
    val pinnedByName: String = "",
)
