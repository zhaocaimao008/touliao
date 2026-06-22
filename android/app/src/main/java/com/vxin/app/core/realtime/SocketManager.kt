package com.vxin.app.core.realtime

import android.util.Log
import com.vxin.app.core.storage.ServerConfig
import com.vxin.app.core.storage.TokenStore
import com.vxin.app.data.model.Message
import com.vxin.app.data.model.MessageReaction
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

enum class SocketStatus { DISCONNECTED, CONNECTING, CONNECTED }

data class TypingEvent(val userId: String, val conversationId: String, val isTyping: Boolean)
data class ReadEvent(val userId: String, val conversationId: String, val readAt: Long, val lastReadMessageId: String?)
data class ReactionEvent(val msgId: String, val reactions: List<MessageReaction>)
data class RedPacketClaimedEvent(val packetId: String, val userId: String, val username: String, val amount: Int)

// ── WebRTC 通话信令 ──
data class CallIncomingEvent(val from: String, val type: String, val callerName: String)
data class CallResponseEvent(val from: String, val accepted: Boolean)
data class CallSdpEvent(val from: String, val sdp: String)            // offer / answer 的 sdp
data class CallIceEvent(val from: String, val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int)
data class CallEndEvent(val from: String)

/**
 * Socket.IO 实时通道（官方 io.socket:socket.io-client）。
 *
 * - 鉴权：handshake auth.token 携带 Bearer（对齐后端 io.use）
 * - 心跳：由 engine.io 内置 ping/pong 维持（服务端配置间隔），官方库自动处理 + 自动重连，
 *   无需自造心跳；这里只对外暴露连接状态。
 * - 接收：监听 new_message / new_message_batch，统一转成 Message 推到 incomingMessages
 * - 发送：emit("send_message", {conversationId, content}) 带 ack，封装为挂起函数
 *
 * 生命周期由 SessionManager 管理：登录/恢复会话后 connect()，登出时 disconnect()。
 */
@Singleton
class SocketManager @Inject constructor(
    private val tokenStore: TokenStore,
    private val serverConfig: ServerConfig,
    private val json: Json,
) {
    private var socket: Socket? = null

    private val _status = MutableStateFlow(SocketStatus.DISCONNECTED)
    val status: StateFlow<SocketStatus> = _status.asStateFlow()

    private val _incomingMessages = MutableSharedFlow<Message>(extraBufferCapacity = 128)
    val incomingMessages: SharedFlow<Message> = _incomingMessages.asSharedFlow()

    private val _typingEvents = MutableSharedFlow<TypingEvent>(extraBufferCapacity = 64)
    val typingEvents: SharedFlow<TypingEvent> = _typingEvents.asSharedFlow()

    private val _readEvents = MutableSharedFlow<ReadEvent>(extraBufferCapacity = 64)
    val readEvents: SharedFlow<ReadEvent> = _readEvents.asSharedFlow()

    /** 本人某会话已读（多端同步 + 本端 markRead 回声）→ 清未读 */
    private val _unreadCleared = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val unreadClearedEvents: SharedFlow<String> = _unreadCleared.asSharedFlow()

    /** 新会话（如被拉入群聊）→ 提示列表刷新 */
    private val _newConversation = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
    val newConversationEvents: SharedFlow<Unit> = _newConversation.asSharedFlow()

    /** 消息撤回/删除 → msgId */
    private val _messageDeleted = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val messageDeletedEvents: SharedFlow<String> = _messageDeleted.asSharedFlow()

    /** 表情回应更新 */
    private val _reaction = MutableSharedFlow<ReactionEvent>(extraBufferCapacity = 64)
    val reactionEvents: SharedFlow<ReactionEvent> = _reaction.asSharedFlow()

    /** 红包被领取 */
    private val _redPacketClaimed = MutableSharedFlow<RedPacketClaimedEvent>(extraBufferCapacity = 64)
    val redPacketClaimedEvents: SharedFlow<RedPacketClaimedEvent> = _redPacketClaimed.asSharedFlow()

    /** 群置顶消息变化（置顶/取消）→ convId，UI 据此重拉置顶列表 */
    private val _pinChanged = MutableSharedFlow<String>(extraBufferCapacity = 32)
    val pinChangedEvents: SharedFlow<String> = _pinChanged.asSharedFlow()

    // ── 通话信令流 ──
    private val _callIncoming = MutableSharedFlow<CallIncomingEvent>(extraBufferCapacity = 16)
    val callIncomingEvents: SharedFlow<CallIncomingEvent> = _callIncoming.asSharedFlow()
    private val _callResponse = MutableSharedFlow<CallResponseEvent>(extraBufferCapacity = 16)
    val callResponseEvents: SharedFlow<CallResponseEvent> = _callResponse.asSharedFlow()
    private val _callOffer = MutableSharedFlow<CallSdpEvent>(extraBufferCapacity = 16)
    val callOfferEvents: SharedFlow<CallSdpEvent> = _callOffer.asSharedFlow()
    private val _callAnswer = MutableSharedFlow<CallSdpEvent>(extraBufferCapacity = 16)
    val callAnswerEvents: SharedFlow<CallSdpEvent> = _callAnswer.asSharedFlow()
    private val _callIce = MutableSharedFlow<CallIceEvent>(extraBufferCapacity = 64)
    val callIceEvents: SharedFlow<CallIceEvent> = _callIce.asSharedFlow()
    private val _callEnd = MutableSharedFlow<CallEndEvent>(extraBufferCapacity = 16)
    val callEndEvents: SharedFlow<CallEndEvent> = _callEnd.asSharedFlow()

    @Synchronized
    fun connect() {
        val token = tokenStore.token ?: return        // 未登录不连
        if (socket?.connected() == true) return

        // 已有实例先清理，避免 token/地址变更后复用旧连接
        disconnectInternal()

        val opts = IO.Options().apply {
            transports = arrayOf("websocket")          // 仅 websocket，匹配服务端
            reconnection = true
            reconnectionDelay = 1000
            reconnectionDelayMax = 10_000
            auth = mapOf("token" to token)             // Bearer 握手鉴权
        }

        val s = try {
            IO.socket(serverConfig.baseUrl, opts)
        } catch (e: Exception) {
            Log.e(TAG, "build socket failed: ${e.message}")
            return
        }
        socket = s

        s.on(Socket.EVENT_CONNECT) { _status.value = SocketStatus.CONNECTED }
        s.on(Socket.EVENT_DISCONNECT) { _status.value = SocketStatus.DISCONNECTED }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            _status.value = SocketStatus.DISCONNECTED
            Log.w(TAG, "connect_error: ${args.firstOrNull()}")
        }

        s.on("new_message") { args -> parseMessage(args.firstOrNull())?.let(_incomingMessages::tryEmit) }
        s.on("new_message_batch") { args ->
            (args.firstOrNull() as? JSONArray)?.let { arr ->
                for (i in 0 until arr.length()) parseMessage(arr.optJSONObject(i))?.let(_incomingMessages::tryEmit)
            }
        }
        s.on("typing") { args -> typingEvent(args.firstOrNull(), isTyping = true) }
        s.on("stop_typing") { args -> typingEvent(args.firstOrNull(), isTyping = false) }
        s.on("message_read") { args ->
            (args.firstOrNull() as? JSONObject)?.let { o ->
                _readEvents.tryEmit(
                    ReadEvent(
                        userId = o.optString("userId"),
                        conversationId = o.optString("conversationId"),
                        readAt = o.optLong("readAt"),
                        lastReadMessageId = o.optString("lastReadMessageId").ifEmpty { null },
                    )
                )
            }
        }
        s.on("sync:unread_cleared") { args ->
            (args.firstOrNull() as? JSONObject)?.optString("conversationId")
                ?.takeIf { it.isNotEmpty() }?.let(_unreadCleared::tryEmit)
        }
        s.on("new_conversation") { _newConversation.tryEmit(Unit) }
        s.on("message_deleted") { args ->
            (args.firstOrNull() as? JSONObject)?.optString("msgId")?.takeIf { it.isNotEmpty() }?.let(_messageDeleted::tryEmit)
        }
        s.on("message_reaction") { args ->
            (args.firstOrNull() as? JSONObject)?.let { o ->
                val msgId = o.optString("msgId")
                val arr = o.optJSONArray("reactions")
                val list = mutableListOf<MessageReaction>()
                if (arr != null) for (i in 0 until arr.length()) {
                    arr.optJSONObject(i)?.let { r -> list.add(MessageReaction(r.optString("emoji"), r.optInt("count"))) }
                }
                if (msgId.isNotEmpty()) _reaction.tryEmit(ReactionEvent(msgId, list))
            }
        }
        s.on("message_pinned") { args ->
            (args.firstOrNull() as? JSONObject)?.optString("convId")?.takeIf { it.isNotEmpty() }?.let(_pinChanged::tryEmit)
        }
        s.on("message_unpinned") { args ->
            (args.firstOrNull() as? JSONObject)?.optString("convId")?.takeIf { it.isNotEmpty() }?.let(_pinChanged::tryEmit)
        }
        s.on("red_packet_claimed") { args ->
            (args.firstOrNull() as? JSONObject)?.let { o ->
                val packetId = o.optString("packetId")
                if (packetId.isNotEmpty()) {
                    _redPacketClaimed.tryEmit(
                        RedPacketClaimedEvent(
                            packetId = packetId,
                            userId = o.optString("userId"),
                            username = o.optString("username"),
                            amount = o.optInt("amount"),
                        )
                    )
                }
            }
        }
        // ── 通话信令接收 ──
        s.on("call:incoming") { args ->
            (args.firstOrNull() as? JSONObject)?.let { o ->
                val from = o.optString("from")
                val caller = o.optJSONObject("caller")?.optString("name").orEmpty()
                if (from.isNotEmpty()) _callIncoming.tryEmit(CallIncomingEvent(from, o.optString("type", "audio"), caller))
            }
        }
        s.on("call:response") { args ->
            (args.firstOrNull() as? JSONObject)?.let { o ->
                val from = o.optString("from")
                if (from.isNotEmpty()) _callResponse.tryEmit(CallResponseEvent(from, o.optBoolean("accepted")))
            }
        }
        s.on("call:offer") { args ->
            (args.firstOrNull() as? JSONObject)?.let { o ->
                val from = o.optString("from")
                val sdp = o.optJSONObject("offer")?.optString("sdp").orEmpty()
                if (from.isNotEmpty() && sdp.isNotEmpty()) _callOffer.tryEmit(CallSdpEvent(from, sdp))
            }
        }
        s.on("call:answer") { args ->
            (args.firstOrNull() as? JSONObject)?.let { o ->
                val from = o.optString("from")
                val sdp = o.optJSONObject("answer")?.optString("sdp").orEmpty()
                if (from.isNotEmpty() && sdp.isNotEmpty()) _callAnswer.tryEmit(CallSdpEvent(from, sdp))
            }
        }
        s.on("call:ice") { args ->
            (args.firstOrNull() as? JSONObject)?.let { o ->
                val from = o.optString("from")
                val cand = o.optJSONObject("candidate")
                if (from.isNotEmpty() && cand != null) {
                    _callIce.tryEmit(
                        CallIceEvent(
                            from = from,
                            candidate = cand.optString("candidate"),
                            sdpMid = cand.optString("sdpMid").takeIf { it.isNotEmpty() },
                            sdpMLineIndex = cand.optInt("sdpMLineIndex"),
                        )
                    )
                }
            }
        }
        s.on("call:end") { args ->
            (args.firstOrNull() as? JSONObject)?.optString("from")?.takeIf { it.isNotEmpty() }
                ?.let { _callEnd.tryEmit(CallEndEvent(it)) }
        }

        _status.value = SocketStatus.CONNECTING
        s.connect()
    }

    /** 通过 socket 发送文本消息；ack 返回服务端落库后的完整 Message */
    suspend fun sendMessage(conversationId: String, content: String, replyToId: String? = null): Result<Message> =
        suspendCancellableCoroutine { cont ->
            val s = socket
            if (s == null || !s.connected()) {
                cont.resume(Result.failure(IllegalStateException("连接已断开")))
                return@suspendCancellableCoroutine
            }
            val payload = JSONObject()
                .put("conversationId", conversationId)
                .put("content", content)
            if (replyToId != null) payload.put("reply_to_id", replyToId)

            s.emit("send_message", payload, Ack { ackArgs ->
                if (!cont.isActive) return@Ack
                val resp = ackArgs.firstOrNull() as? JSONObject
                when {
                    resp == null -> cont.resume(Result.failure(IllegalStateException("无响应")))
                    resp.optBoolean("success", false) -> {
                        val msg = parseMessage(resp.optJSONObject("message"))
                        if (msg != null) cont.resume(Result.success(msg))
                        else cont.resume(Result.failure(IllegalStateException("响应解析失败")))
                    }
                    else -> cont.resume(Result.failure(RuntimeException(resp.optString("error", "发送失败"))))
                }
            })
        }

    /** 进入会话时主动入房（连上后服务端已自动入房，这里兜底防时序） */
    fun joinConversation(conversationId: String) {
        socket?.emit("join_conversation", JSONObject().put("conversationId", conversationId))
    }

    fun emitTyping(conversationId: String) {
        socket?.emit("typing", JSONObject().put("conversationId", conversationId))
    }

    fun emitStopTyping(conversationId: String) {
        socket?.emit("stop_typing", JSONObject().put("conversationId", conversationId))
    }

    // ── 通话信令发送 ──
    fun emitCallRequest(to: String, type: String, callerName: String) {
        socket?.emit("call:request", JSONObject()
            .put("to", to).put("type", type)
            .put("caller", JSONObject().put("name", callerName)))
    }

    fun emitCallResponse(to: String, accepted: Boolean) {
        socket?.emit("call:response", JSONObject().put("to", to).put("accepted", accepted))
    }

    fun emitCallOffer(to: String, sdp: String) {
        socket?.emit("call:offer", JSONObject()
            .put("to", to).put("offer", JSONObject().put("type", "offer").put("sdp", sdp)))
    }

    fun emitCallAnswer(to: String, sdp: String) {
        socket?.emit("call:answer", JSONObject()
            .put("to", to).put("answer", JSONObject().put("type", "answer").put("sdp", sdp)))
    }

    fun emitCallIce(to: String, candidate: String, sdpMid: String?, sdpMLineIndex: Int) {
        socket?.emit("call:ice", JSONObject()
            .put("to", to)
            .put("candidate", JSONObject()
                .put("candidate", candidate)
                .put("sdpMid", sdpMid ?: JSONObject.NULL)
                .put("sdpMLineIndex", sdpMLineIndex)))
    }

    fun emitCallEnd(to: String) {
        socket?.emit("call:end", JSONObject().put("to", to))
    }

    @Synchronized
    fun disconnect() {
        disconnectInternal()
        _status.value = SocketStatus.DISCONNECTED
    }

    private fun typingEvent(any: Any?, isTyping: Boolean) {
        (any as? JSONObject)?.let { o ->
            _typingEvents.tryEmit(TypingEvent(o.optString("userId"), o.optString("conversationId"), isTyping))
        }
    }

    private fun disconnectInternal() {
        socket?.apply {
            off()
            disconnect()
        }
        socket = null
    }

    private fun parseMessage(any: Any?): Message? {
        val obj = any as? JSONObject ?: return null
        return runCatching { json.decodeFromString<Message>(obj.toString()) }
            .onFailure { Log.w(TAG, "parse message failed: ${it.message}") }
            .getOrNull()
    }

    private companion object {
        const val TAG = "SocketManager"
    }
}
