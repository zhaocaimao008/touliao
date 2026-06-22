package com.vxin.app.feature.chat

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.AuthState
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.media.AudioPlayer
import com.vxin.app.core.media.AudioRecorder
import com.vxin.app.core.media.MediaUploader
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.util.MediaUrlResolver
import com.vxin.app.data.model.Message
import com.vxin.app.data.model.RedPacketContent
import com.vxin.app.data.model.RedPacketDetail
import com.vxin.app.data.repository.ChatRepository
import com.vxin.app.data.repository.RedPacketRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.serialization.json.Json
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import javax.inject.Inject

/** 上传中的占位项（成功后被真实 Message 替换） */
data class PendingUpload(
    val tempId: String,
    val type: String,            // image | voice | video | file
    val name: String,
    val localUri: String? = null, // 图片本地预览
    val failed: Boolean = false,
)

data class ChatUiState(
    val title: String = "",
    val loading: Boolean = false,
    val messages: List<Message> = emptyList(),
    val pending: List<PendingUpload> = emptyList(),
    val input: String = "",
    val sending: Boolean = false,
    val recording: Boolean = false,
    val peerTyping: Boolean = false,
    val peerReadAt: Long = 0,         // 对方已读时间（秒）；我的消息 createdAt <= 此值即「已读」
    val replyingTo: Message? = null,  // 正在回复的消息
    val closed: Boolean = false,      // 被踢/群解散 → 关闭聊天页
    val stickers: List<com.vxin.app.data.model.Sticker> = emptyList(),
    val pinnedMessages: List<com.vxin.app.data.model.PinnedMessage> = emptyList(),
    val forwardTargets: List<com.vxin.app.data.model.Conversation> = emptyList(),  // 转发可选会话
    // ── 红包 ──
    val redPacketDetail: RedPacketDetail? = null,   // 非空 = 显示红包详情弹窗
    val redPacketLoading: Boolean = false,
    val claimedAmount: Int? = null,                 // 刚领取到的金额（一次性提示）
    val error: String? = null,
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    private val stickerRepository: com.vxin.app.data.repository.StickerRepository,
    private val redPacketRepository: RedPacketRepository,
    private val callManager: com.vxin.app.core.call.CallManager,
    private val mediaUploader: MediaUploader,
    private val audioRecorder: AudioRecorder,
    private val audioPlayer: AudioPlayer,
    private val mediaUrlResolver: MediaUrlResolver,
    sessionManager: SessionManager,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val conversationId: String = savedStateHandle.get<String>("conversationId").orEmpty()
    private val title: String = savedStateHandle.get<String>("title").orEmpty()
    val isGroup: Boolean = savedStateHandle.get<String>("type") == "group"

    val myId: String = (sessionManager.state.value as? AuthState.Authenticated)?.user?.id.orEmpty()

    private val _uiState = MutableStateFlow(ChatUiState(title = title, loading = true))
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private var lastTypingEmit = 0L
    private var typingClearJob: Job? = null
    private val json = Json { ignoreUnknownKeys = true }

    init {
        chatRepository.joinConversation(conversationId)
        loadHistory()
        observeIncoming()
        observeTyping()
        observeRead()
        observeDeleted()
        observeReaction()
        observeEdited()
        observeRedPacketClaimed()
        if (isGroup) {
            loadPinned()
            observePinChanged()
            observeGroupGone()
        }
    }

    private fun observeGroupGone() {
        viewModelScope.launch {
            chatRepository.groupGoneEvents.collect { convId -> if (convId == conversationId) _uiState.update { it.copy(closed = true) } }
        }
    }

    // ── 群置顶消息 ─────────────────────────────────────────
    fun isPinned(msgId: String): Boolean = _uiState.value.pinnedMessages.any { it.msgId == msgId }

    private fun loadPinned() {
        viewModelScope.launch {
            runCatching { chatRepository.pinnedMessages(conversationId) }
                .onSuccess { list -> _uiState.update { it.copy(pinnedMessages = list) } }
        }
    }

    fun pinMessage(msg: Message) {
        viewModelScope.launch {
            runCatching { chatRepository.pinMessage(conversationId, msg.id) }
                .onSuccess { loadPinned() }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("置顶失败")) } }
        }
    }

    fun unpinMessage(msgId: String) {
        viewModelScope.launch {
            runCatching { chatRepository.unpinMessage(conversationId, msgId) }
                .onSuccess { loadPinned() }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("取消置顶失败")) } }
        }
    }

    private fun observePinChanged() {
        viewModelScope.launch {
            chatRepository.pinChangedEvents.collect { convId -> if (convId == conversationId) loadPinned() }
        }
    }

    // ── 红包 ──────────────────────────────────────────────
    /** 解析 red_packet 消息的 content（失败返回 null） */
    fun parseRedPacket(msg: Message): RedPacketContent? =
        if (msg.type == "red_packet") runCatching { json.decodeFromString<RedPacketContent>(msg.content) }.getOrNull() else null

    fun sendRedPacket(totalAmount: Int, totalCount: Int, greeting: String) {
        viewModelScope.launch {
            runCatching { redPacketRepository.send(conversationId, totalAmount, totalCount, greeting.trim()) }
                .onSuccess { resp -> resp.message?.let { appendUnique(it) } } // 通常 socket 也会广播，appendUnique 去重
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("发送红包失败")) } }
        }
    }

    /** 点击红包消息 → 拉详情并弹窗 */
    fun openRedPacket(msg: Message) {
        val packetId = parseRedPacket(msg)?.packetId ?: return
        _uiState.update { it.copy(redPacketLoading = true, claimedAmount = null) }
        viewModelScope.launch {
            runCatching { redPacketRepository.detail(packetId) }
                .onSuccess { d -> _uiState.update { it.copy(redPacketLoading = false, redPacketDetail = d) } }
                .onFailure { e -> _uiState.update { it.copy(redPacketLoading = false, error = e.toUserMessage("打开红包失败")) } }
        }
    }

    fun claimOpenedRedPacket() {
        val packetId = _uiState.value.redPacketDetail?.id ?: return
        viewModelScope.launch {
            runCatching { redPacketRepository.claim(packetId) }
                .onSuccess { resp ->
                    _uiState.update { it.copy(claimedAmount = resp.amount) }
                    refreshRedPacketDetail(packetId)
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("手慢了，红包没抢到")) }; refreshRedPacketDetail(packetId) }
        }
    }

    fun closeRedPacket() = _uiState.update { it.copy(redPacketDetail = null, claimedAmount = null) }

    // ── 音视频通话 ─────────────────────────────────────────
    /** 私聊对方 userId：取历史里第一条非本人消息的发送者 */
    private fun peerId(): String? = _uiState.value.messages.firstOrNull { it.sender_id != myId }?.sender_id

    /** 发起通话；无法确定对方（如群聊/无消息）返回 false */
    fun startCall(video: Boolean): Boolean {
        if (isGroup) return false
        val peer = peerId() ?: return false
        callManager.startCall(peer, _uiState.value.title, video)
        return true
    }

    private fun refreshRedPacketDetail(packetId: String) {
        viewModelScope.launch {
            runCatching { redPacketRepository.detail(packetId) }
                .onSuccess { d -> _uiState.update { if (it.redPacketDetail?.id == packetId) it.copy(redPacketDetail = d) else it } }
        }
    }

    private fun observeRedPacketClaimed() {
        viewModelScope.launch {
            chatRepository.redPacketClaimedEvents.collect { e ->
                // 详情弹窗开着且是同一个红包 → 刷新领取记录
                if (_uiState.value.redPacketDetail?.id == e.packetId) refreshRedPacketDetail(e.packetId)
            }
        }
    }

    // ── 表情/贴纸 ──────────────────────────────────────
    fun appendEmoji(emoji: String) = _uiState.update { it.copy(input = it.input + emoji) }

    fun loadStickers() {
        viewModelScope.launch {
            runCatching { stickerRepository.list() }.onSuccess { list -> _uiState.update { it.copy(stickers = list) } }
        }
    }

    fun sendSticker(sticker: com.vxin.app.data.model.Sticker) {
        viewModelScope.launch {
            runCatching { stickerRepository.send(conversationId, sticker.id) }
                .onSuccess { msg -> appendUnique(msg) }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("发送失败")) } }
        }
    }

    fun collectMessage(msg: Message) {
        viewModelScope.launch {
            runCatching { chatRepository.collectMessage(msg.id) }
                .onSuccess { _uiState.update { it.copy(error = "已收藏") } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("收藏失败")) } }
        }
    }

    fun collectSticker(fileUrl: String) {
        viewModelScope.launch {
            runCatching { stickerRepository.collect(fileUrl) }
                .onSuccess { _uiState.update { it.copy(error = "已添加到表情") }; loadStickers() }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("收藏失败")) } }
        }
    }

    // ── 消息操作:回复/撤回/表情回应 ──────────────────────
    fun startReply(msg: Message) = _uiState.update { it.copy(replyingTo = msg) }
    fun cancelReply() = _uiState.update { it.copy(replyingTo = null) }

    fun recall(msg: Message) {
        viewModelScope.launch { chatRepository.deleteMessage(msg.id, forEveryone = true) }
        // 实时事件 message_deleted 会移除;此处不乐观删除以保持一致
    }

    fun react(msg: Message, emoji: String) {
        viewModelScope.launch {
            chatRepository.react(msg.id, emoji)
                .onSuccess { resp -> updateReactions(msg.id, resp.reactions) }
        }
    }

    private fun observeDeleted() {
        viewModelScope.launch {
            chatRepository.messageDeletedEvents.collect { msgId ->
                _uiState.update { it.copy(messages = it.messages.filterNot { m -> m.id == msgId }) }
            }
        }
    }

    private fun observeReaction() {
        viewModelScope.launch {
            chatRepository.reactionEvents.collect { e -> updateReactions(e.msgId, e.reactions) }
        }
    }

    // ── 消息编辑 / 转发 ──────────────────────────────────
    private fun observeEdited() {
        viewModelScope.launch {
            chatRepository.messageEditedEvents.collect { e ->
                if (e.conversationId != conversationId) return@collect
                _uiState.update { s ->
                    s.copy(messages = s.messages.map { if (it.id == e.msgId) it.copy(content = e.content, edited = 1) else it })
                }
            }
        }
    }

    /** 是否可编辑：本人文本消息且 2 分钟内 */
    fun canEdit(msg: Message): Boolean =
        msg.sender_id == myId && msg.type == "text" &&
            (System.currentTimeMillis() / 1000 - msg.created_at) <= 120

    fun editMessage(msg: Message, newText: String) {
        val text = newText.trim()
        if (text.isEmpty()) return
        viewModelScope.launch {
            runCatching { chatRepository.editMessage(msg.id, text) }
                .onSuccess {
                    _uiState.update { s -> s.copy(messages = s.messages.map { if (it.id == msg.id) it.copy(content = text, edited = 1) else it }) }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("编辑失败")) } }
        }
    }

    fun loadForwardTargets() {
        viewModelScope.launch {
            runCatching { chatRepository.loadConversations() }
                .onSuccess { list -> _uiState.update { it.copy(forwardTargets = list) } }
        }
    }

    fun forward(msg: Message, conversationIds: List<String>) {
        if (conversationIds.isEmpty()) return
        viewModelScope.launch {
            runCatching { chatRepository.forward(msg.id, conversationIds) }
                .onSuccess { _uiState.update { it.copy(error = "已转发") } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("转发失败")) } }
        }
    }

    private fun updateReactions(msgId: String, reactions: List<com.vxin.app.data.model.MessageReaction>) {
        _uiState.update { s ->
            s.copy(messages = s.messages.map { if (it.id == msgId) it.copy(reactions = reactions) else it })
        }
    }

    /** /uploads 相对路径 → 带 token 的绝对地址，供 Coil/播放器加载 */
    fun resolveMediaUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    /** 播放语音消息 */
    fun playVoice(fileUrl: String) {
        resolveMediaUrl(fileUrl)?.let(audioPlayer::play)
    }

    private fun loadHistory() {
        viewModelScope.launch {
            runCatching { chatRepository.loadHistory(conversationId) }
                .onSuccess { list ->
                    _uiState.update { it.copy(loading = false, messages = list) }
                    markReadLatest()   // 打开会话即标记已读
                }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载消息失败")) } }
        }
    }

    private fun observeIncoming() {
        viewModelScope.launch {
            chatRepository.incomingMessages.collect { msg ->
                if (msg.conversation_id != conversationId) return@collect
                appendUnique(msg)
                if (msg.sender_id != myId) markReadLatest()   // 在会话内收到对方消息即已读
            }
        }
    }

    private fun observeTyping() {
        viewModelScope.launch {
            chatRepository.typingEvents.collect { e ->
                if (e.conversationId != conversationId || e.userId == myId) return@collect
                _uiState.update { it.copy(peerTyping = e.isTyping) }
                typingClearJob?.cancel()
                if (e.isTyping) {
                    // 兜底：5s 无新 typing 自动隐藏（防 stop 丢失）
                    typingClearJob = launch {
                        delay(5000)
                        _uiState.update { it.copy(peerTyping = false) }
                    }
                }
            }
        }
    }

    private fun observeRead() {
        viewModelScope.launch {
            chatRepository.readEvents.collect { e ->
                if (e.conversationId != conversationId || e.userId == myId) return@collect
                _uiState.update { if (e.readAt > it.peerReadAt) it.copy(peerReadAt = e.readAt) else it }
            }
        }
    }

    /** 我的消息是否已被对方读过（双勾） */
    fun isReadByPeer(msg: Message): Boolean =
        msg.sender_id == myId && _uiState.value.peerReadAt > 0 && msg.created_at <= _uiState.value.peerReadAt

    private fun markReadLatest() {
        val last = _uiState.value.messages.lastOrNull() ?: return
        viewModelScope.launch { chatRepository.markRead(conversationId, last.id) }
    }

    /** 退出聊天时发送 read + stop_typing */
    fun onLeave() {
        chatRepository.emitStopTyping(conversationId)
        markReadLatest()
    }

    // ── 文本 ──────────────────────────────────────────────
    fun onInputChange(v: String) {
        _uiState.update { it.copy(input = v) }
        // 节流：非空且距上次 emit > 2s 才发 typing，避免刷屏
        val now = System.currentTimeMillis()
        if (v.isNotBlank() && now - lastTypingEmit > 2000) {
            lastTypingEmit = now
            chatRepository.emitTyping(conversationId)
        }
    }

    fun send() {
        val text = _uiState.value.input.trim()
        if (text.isEmpty() || _uiState.value.sending) return
        val replyId = _uiState.value.replyingTo?.id
        _uiState.update { it.copy(input = "", sending = true, error = null, replyingTo = null) }
        chatRepository.emitStopTyping(conversationId)
        viewModelScope.launch {
            chatRepository.sendText(conversationId, text, replyId)
                .onSuccess { msg -> appendUnique(msg); _uiState.update { it.copy(sending = false) } }
                .onFailure { e -> _uiState.update { it.copy(sending = false, input = text, error = e.toUserMessage("发送失败")) } }
        }
    }

    // ── 媒体上传（图片/文件/录音）──────────────────────────
    fun uploadFromUri(uri: Uri, previewLocal: Boolean) {
        viewModelScope.launch {
            val prepared = withContext(Dispatchers.IO) { runCatching { mediaUploader.prepareFromUri(uri) }.getOrNull() }
            if (prepared == null) {
                _uiState.update { it.copy(error = "无法读取所选文件") }
                return@launch
            }
            val pending = PendingUpload(
                tempId = UUID.randomUUID().toString(),
                type = prepared.localType,
                name = prepared.displayName,
                localUri = if (previewLocal) uri.toString() else null,
            )
            runUpload(pending) { chatRepository.uploadMedia(conversationId, prepared.part) }
        }
    }

    fun startRecording() {
        if (_uiState.value.recording) return
        if (audioRecorder.start()) {
            _uiState.update { it.copy(recording = true, error = null) }
        } else {
            _uiState.update { it.copy(error = "无法开始录音") }
        }
    }

    fun stopRecordingAndSend() {
        if (!_uiState.value.recording) return
        _uiState.update { it.copy(recording = false) }
        val file = audioRecorder.stop() ?: run {
            _uiState.update { it.copy(error = "录音失败") }
            return
        }
        viewModelScope.launch {
            val prepared = withContext(Dispatchers.IO) {
                mediaUploader.prepareFromFile(file, audioRecorder.mimeType, file.name)
            }
            val pending = PendingUpload(UUID.randomUUID().toString(), "voice", "语音")
            runUpload(pending) { chatRepository.uploadMedia(conversationId, prepared.part) }
        }
    }

    fun cancelRecording() {
        audioRecorder.cancel()
        _uiState.update { it.copy(recording = false) }
    }

    private fun runUpload(pending: PendingUpload, block: suspend () -> Message) {
        addPending(pending)
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { msg -> removePending(pending.tempId); appendUnique(msg) }
                .onFailure { e ->
                    markPendingFailed(pending.tempId)
                    _uiState.update { it.copy(error = e.toUserMessage("上传失败")) }
                }
        }
    }

    fun dismissFailedPending(tempId: String) =
        _uiState.update { it.copy(pending = it.pending.filterNot { p -> p.tempId == tempId }) }

    // ── helpers ──────────────────────────────────────────
    private fun addPending(p: PendingUpload) =
        _uiState.update { it.copy(pending = it.pending + p) }

    private fun removePending(tempId: String) =
        _uiState.update { it.copy(pending = it.pending.filterNot { p -> p.tempId == tempId }) }

    private fun markPendingFailed(tempId: String) =
        _uiState.update { s -> s.copy(pending = s.pending.map { if (it.tempId == tempId) it.copy(failed = true) else it }) }

    private fun appendUnique(msg: Message) {
        _uiState.update { state ->
            if (state.messages.any { it.id == msg.id }) state
            else state.copy(messages = state.messages + msg)
        }
    }

    override fun onCleared() {
        audioRecorder.cancel()
        audioPlayer.stop()
        super.onCleared()
    }
}
