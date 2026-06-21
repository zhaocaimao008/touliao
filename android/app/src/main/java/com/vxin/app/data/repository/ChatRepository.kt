package com.vxin.app.data.repository

import com.vxin.app.core.realtime.ReadEvent
import com.vxin.app.core.realtime.SocketManager
import com.vxin.app.core.realtime.SocketStatus
import com.vxin.app.core.realtime.TypingEvent
import com.vxin.app.data.api.MessageApi
import com.vxin.app.data.model.Conversation
import com.vxin.app.data.model.MarkReadRequest
import com.vxin.app.data.model.Message
import okhttp3.MultipartBody
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepository @Inject constructor(
    private val api: MessageApi,
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

    fun joinConversation(conversationId: String) = socketManager.joinConversation(conversationId)
    fun emitTyping(conversationId: String) = socketManager.emitTyping(conversationId)
    fun emitStopTyping(conversationId: String) = socketManager.emitStopTyping(conversationId)

    /** 标记会话已读 */
    suspend fun markRead(conversationId: String, messageId: String?) {
        runCatching { api.markRead(conversationId, MarkReadRequest(messageId)) }
    }

    suspend fun loadConversations(): List<Conversation> = api.conversations()

    suspend fun loadHistory(conversationId: String, before: Long? = null): List<Message> =
        api.history(conversationId, before = before)

    suspend fun sendText(conversationId: String, content: String): Result<Message> =
        socketManager.sendMessage(conversationId, content)

    /** 上传媒体并返回服务端创建的消息（同时会经 Socket 广播给其他端） */
    suspend fun uploadMedia(conversationId: String, part: MultipartBody.Part): Message =
        api.upload(conversationId, part)
}
