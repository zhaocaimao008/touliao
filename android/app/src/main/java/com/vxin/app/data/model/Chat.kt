package com.vxin.app.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

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
    val background: String = "",            // 聊天专属背景图（空=无）
    val otherUser: ConversationOtherUser? = null,  // 私聊对方（后端 listConversations 私聊项返回；群聊为 null）
)

/** 私聊对方简表（后端 listConversations 私聊项的 otherUser 字段） */
@Serializable
data class ConversationOtherUser(
    val id: String = "",
    val username: String = "",
    val avatar: String = "",
)

@Serializable
data class MarkReadRequest(val messageId: String? = null)

@Serializable
data class PinConversationBody(val pinned: Int)

@Serializable
data class MuteConversationBody(val muted: Int)

/** 设置聊天背景（空串=清除） */
@Serializable
data class BackgroundBody(val background: String)

/**
 * 消息 —— REST history 与 Socket new_message 共用同一结构。
 * @Immutable：含 List<MessageReaction> 会令 Compose 推断整个类为 unstable，
 * 导致 MessageBubble 永不跳过重组（聊天时任何状态变化都会重绘全部可见气泡→掉帧）。
 * 本类为纯 DTO，全 val、更新只经 .copy() 从不原地改，标注 @Immutable 属实且安全。
 */
@Immutable
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
    val edited: Int = 0,                    // 1 = 已编辑
    val deleted: Int = 0,                   // 1 = 已撤回/删除（后端 schema 字段，避免反序列化丢字段）
    val reactions: List<MessageReaction> = emptyList(),
    val replyTo: ReplyPreview? = null,
    // ── 客户端本地态（不参与序列化；对齐 Web 乐观消息）──
    // localStatus: null=已送达的服务端消息 | "sending"=乐观发送中 | "failed"=发送失败
    @Transient val localStatus: String? = null,
    // 幂等键：乐观消息发送时生成，失败重发复用，后端据此去重（防重复气泡）
    @Transient val clientMsgId: String? = null,
)

/** 消息本地发送态常量 */
object LocalMsgStatus {
    const val SENDING = "sending"
    const val FAILED = "failed"
}

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
data class DeleteMessageBody(val forEveryone: Boolean = true, val vanish: Boolean = false)

@Serializable
data class ReactBody(val emoji: String)

@Serializable
data class ReactResponse(val reactions: List<MessageReaction> = emptyList())

@Serializable
data class EditMessageBody(val content: String)

@Serializable
data class ForwardBody(val msgId: String, val conversationIds: List<String>)

@Serializable
data class BatchDeleteBody(val msgIds: List<String>, val conversationId: String)

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
