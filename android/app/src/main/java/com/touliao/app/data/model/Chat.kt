package com.touliao.app.data.model

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
    @kotlinx.serialization.SerialName("burn_after")
    val burnAfter: Int = 0,                 // 阅后即焚秒数（0=关闭）
    @kotlinx.serialization.SerialName("manually_unread")
    val manuallyUnread: Int = 0,            // 手动标为未读（1=是）
    val hasMention: Boolean = false,        // 群内有人 @我（含 @所有人）且未读 → 列表红色「[有人@我]」提示
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

/** 阅后即焚：seconds=0 关闭 */
@Serializable
data class BurnAfterBody(val seconds: Int)

/** 文件传输助手会话 */
@Serializable
data class FileHelperResponse(val conversationId: String)

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
    // 定时消息标记：1=此消息由定时任务触发发送（已到点后才出现在会话中）
    @kotlinx.serialization.SerialName("is_scheduled")
    val isScheduled: Int = 0,
    // 功能A3: 语音转文字结果（后端消息查询已返回该列；非空=已转写，直接显示，不再显示「转文字」按钮）
    @kotlinx.serialization.SerialName("transcript")
    val transcript: String? = null,
    // 2026-08-29 统一附件系统：真实 mime/size（服务端魔数校验后落库），供文件卡片显示
    // 类型/大小、判断能否 App 内预览（PDF/Word/Excel/PPT）。旧消息可能为 null。
    val file_mime: String? = null,
    val file_size: Long? = null,
    // 2026-08-29新增：语音/视频时长(秒)。后端此前从不写这个字段，语音气泡只能显示固定文字；
    // 现在上传时可选传duration，服务端落库后这里能拿到真实值渲染时长气泡。
    val duration: Int = 0,
    val server_sequence: Long = 0,
    val batch_id: String? = null,
    val client_batch_id: String? = null,
    // 2026-08-29新增：后端history接口早就按 peerLastReadAt 算好了每条消息是否已被对方读过
    // (Web一直在用)，Android/iOS之前都只靠实时socket message_read事件更新peerReadAt，
    // 重新打开会话后、对方在离线期间读过的消息全部会误显示成"未读"。这里补上对这个已有
    // 字段的解码，isReadByPeer优先信它，不够再退回peerReadAt兜底(处理同一会话内实时更新)。
    @kotlinx.serialization.SerialName("_read")
    val read: Boolean = false,
)

@Serializable
data class ConversationEvent(
    val server_sequence: Long,
    val event_type: String,
    val message_id: String,
    val message: Message? = null,
    val payload: Map<String, String> = emptyMap(),
    val batch_id: String? = null,
    val client_batch_id: String? = null,
)

@Serializable
data class MessageSyncResponse(
    val next_cursor: Long,
    val has_more: Boolean,
    val messages: List<ConversationEvent>,
)

/** 消息本地发送态常量 */
object LocalMsgStatus {
    const val SENDING = "sending"
    const val FAILED = "failed"
}

@Serializable
data class MessageReaction(
    val emoji: String = "",
    val count: Int = 0,
    val userIds: List<String> = emptyList(),   // 贴此表情的用户 id（用于高亮「我」，对齐 Web）
) {
    /** 当前用户是否贴过此表情 */
    fun mine(myId: String): Boolean = userIds.contains(myId)
}

/** 被回复消息的摘要(后端 history/new_message 的 replyTo 字段) */
@Serializable
data class ReplyPreview(
    val id: String = "",
    val type: String = "text",
    val content: String = "",
    val senderName: String = "",
    @kotlinx.serialization.SerialName("file_url")
    val fileUrl: String? = null,   // 图片/表情/视频等媒体地址(引用条缩略图用, 对齐 Web)
    val deleted: Int = 0,   // 1 = 被回复的消息已撤回（显示「消息已撤回」，对齐 Web）
)

@Serializable
data class DeleteMessageBody(val forEveryone: Boolean = true, val vanish: Boolean = false, val forMe: Boolean = false)

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

// ── 功能A2: 消息定时发送 ─────────────────────────────────────────────────────

/** 创建定时消息请求体（POST /api/messages/schedule） */
@Serializable
data class ScheduleMessageBody(
    val conversation_id: String,
    val content: String,
    val type: String = "text",
    val send_at: Long,   // UNIX 秒，需 ≥15 分钟后且 ≤30 天
)

/** 定时消息列表项（GET /api/messages/schedule） */
@Serializable
data class ScheduledMessage(
    val id: String = "",
    val conversation_id: String = "",
    val content: String = "",
    val type: String = "text",
    val send_at: Long = 0,       // UNIX 秒
    val status: String = "pending",   // pending | sent | cancelled
    val created_at: Long = 0,
)

// ── 功能A2: @我消息聚合 ──────────────────────────────────────────────────────

/** @我消息列表项（GET /api/messages/mentions/me） */
@Serializable
data class MentionItem(
    val msgId: String = "",
    val convId: String = "",
    val convName: String = "",
    val senderName: String = "",
    val content: String = "",
    val createdAt: Long = 0,   // UNIX 秒
)

/** @我消息分页响应 */
@Serializable
data class MentionsResponse(
    val items: List<MentionItem> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
)

// ── 功能A3: 聊天文件聚合视图 ─────────────────────────────────────────────────

/** 会话文件聚合项（GET /api/messages/conversation/:convId/files 返回的 items 元素） */
@Serializable
data class ConversationFile(
    val id: String = "",
    val type: String = "file",      // image | video | file
    val content: String = "",       // 文件名（文件类）/文本
    val file_url: String = "",      // 相对资源路径
    val created_at: Long = 0,       // epoch 秒
    val senderName: String = "",
)

/** 会话文件聚合分页响应 */
@Serializable
data class ConversationFilesResponse(
    val items: List<ConversationFile> = emptyList(),
    val total: Int = 0,
)

// ── 功能A3: 语音转文字 ───────────────────────────────────────────────────────

/** 语音转文字响应（POST /api/messages/:msgId/transcribe）；cached=true 表示命中后端缓存 */
@Serializable
data class TranscribeResponse(
    val text: String = "",
    val cached: Boolean = false,
)
