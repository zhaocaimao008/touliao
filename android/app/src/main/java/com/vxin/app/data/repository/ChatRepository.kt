package com.vxin.app.data.repository

import com.vxin.app.core.realtime.ReactionEvent
import com.vxin.app.core.realtime.ReadEvent
import com.vxin.app.core.realtime.RedPacketClaimedEvent
import com.vxin.app.core.media.ChunkUploader
import com.vxin.app.core.media.MediaUploader
import com.vxin.app.core.realtime.SocketManager
import com.vxin.app.core.realtime.SocketStatus
import com.vxin.app.core.realtime.TypingEvent
import com.vxin.app.data.api.MessageApi
import com.vxin.app.data.model.Conversation
import com.vxin.app.data.model.DeleteMessageBody
import com.vxin.app.data.model.MarkReadRequest
import com.vxin.app.data.model.Message
import com.vxin.app.data.model.ReactBody
import okhttp3.MultipartBody
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepository @Inject constructor(
    private val api: MessageApi,
    private val chunkUploader: ChunkUploader,
    private val socketManager: SocketManager,
) {
    /** 实时连接状态（供 UI 显示「连接中/已连接」） */
    val socketStatus: StateFlow<SocketStatus> = socketManager.status

    /** 全局新消息流（各会话共用，UI 自行按 conversation_id 过滤） */
    val incomingMessages: SharedFlow<Message> = socketManager.incomingMessages

    /** typing / 已读 / 未读清除 事件流 */
    val typingEvents: SharedFlow<TypingEvent> = socketManager.typingEvents
    val readEvents: SharedFlow<ReadEvent> = socketManager.readEvents
    val unreadClearedEvents: SharedFlow<String> = socketManager.unreadClearedEvents
    val newConversationEvents: SharedFlow<Unit> = socketManager.newConversationEvents
    val messageDeletedEvents: SharedFlow<String> = socketManager.messageDeletedEvents
    val messageVanishedEvents: SharedFlow<String> = socketManager.messageVanishedEvents
    val conversationClearedEvents: SharedFlow<String> = socketManager.conversationClearedEvents
    val reactionEvents: SharedFlow<ReactionEvent> = socketManager.reactionEvents
    val redPacketClaimedEvents: SharedFlow<RedPacketClaimedEvent> = socketManager.redPacketClaimedEvents
    val pinChangedEvents: SharedFlow<String> = socketManager.pinChangedEvents
    val groupGoneEvents: SharedFlow<String> = socketManager.groupGoneEvents
    val groupChangedEvents: SharedFlow<String> = socketManager.groupChangedEvents
    val messageEditedEvents: SharedFlow<com.vxin.app.core.realtime.MessageEditedEvent> = socketManager.messageEditedEvents

    fun joinConversation(conversationId: String) = socketManager.joinConversation(conversationId)
    fun emitTyping(conversationId: String) = socketManager.emitTyping(conversationId)
    fun emitStopTyping(conversationId: String) = socketManager.emitStopTyping(conversationId)

    /** 拍一拍（私聊可省略 targetId，服务端自动取对方） */
    fun nudge(conversationId: String, targetId: String? = null) = socketManager.emitNudge(conversationId, targetId)

    /** 设置/清除聊天专属背景（空串=清除） */
    suspend fun setConversationBackground(conversationId: String, background: String) =
        api.setBackground(conversationId, com.vxin.app.data.model.BackgroundBody(background))

    /** 标记会话已读 */
    suspend fun markRead(conversationId: String, messageId: String?) {
        runCatching { api.markRead(conversationId, MarkReadRequest(messageId)) }
    }

    suspend fun loadConversations(): List<Conversation> = api.conversations()

    suspend fun loadHistory(conversationId: String, before: Long? = null): List<Message> =
        api.history(conversationId, before = before)

    suspend fun sendText(conversationId: String, content: String, replyToId: String? = null): Result<Message> =
        socketManager.sendMessage(conversationId, content, replyToId)

    /** 上传媒体并返回服务端创建的消息（同时会经 Socket 广播给其他端） */
    suspend fun uploadMedia(conversationId: String, part: MultipartBody.Part): Message =
        api.upload(conversationId, part)

    /**
     * 按文件大小自动选择单次上传或分片上传（>8MB 走分片，对齐 Web）。
     */
    suspend fun uploadPrepared(
        conversationId: String,
        prepared: MediaUploader.Prepared,
        replyToId: String? = null,
        onProgress: ((Int) -> Unit)? = null,
    ): Message {
        return if (prepared.file.length() > ChunkUploader.CHUNK_THRESHOLD) {
            chunkUploader.upload(
                conversationId,
                prepared.file,
                prepared.displayName,
                prepared.mime,
                replyToId,
                onProgress,
            )
        } else {
            api.upload(conversationId, prepared.part)
        }
    }

    /** 撤回/删除消息 */
    suspend fun deleteMessage(msgId: String, forEveryone: Boolean = true) =
        runCatching { api.deleteMessage(msgId, DeleteMessageBody(forEveryone)) }

    suspend fun vanishMessage(msgId: String) =
        runCatching { api.deleteMessage(msgId, DeleteMessageBody(vanish = true)) }

    /** 表情回应(切换) */
    suspend fun react(msgId: String, emoji: String) =
        runCatching { api.react(msgId, ReactBody(emoji)) }

    // ── 群置顶消息 ──
    suspend fun pinMessage(conversationId: String, msgId: String) =
        api.pinMessage(conversationId, com.vxin.app.data.model.PinMessageBody(msgId))

    suspend fun unpinMessage(conversationId: String, msgId: String) =
        api.unpinMessage(conversationId, msgId)

    suspend fun pinnedMessages(conversationId: String) = api.pinnedMessages(conversationId)

    // ── 会话操作 ──
    suspend fun setConversationPinned(conversationId: String, pinned: Boolean) =
        api.pinConversation(conversationId, com.vxin.app.data.model.PinConversationBody(if (pinned) 1 else 0))

    suspend fun setConversationMuted(conversationId: String, muted: Boolean) =
        api.muteConversation(conversationId, com.vxin.app.data.model.MuteConversationBody(if (muted) 1 else 0))

    suspend fun clearMessages(conversationId: String) = api.clearMessages(conversationId)

    suspend fun editMessage(msgId: String, content: String) =
        api.editMessage(msgId, com.vxin.app.data.model.EditMessageBody(content))

    suspend fun forward(msgId: String, conversationIds: List<String>) =
        api.forward(com.vxin.app.data.model.ForwardBody(msgId, conversationIds))

    suspend fun collectMessage(msgId: String) = api.collectMessage(msgId)
}
