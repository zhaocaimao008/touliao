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
import com.vxin.app.data.model.LocalMsgStatus
import com.vxin.app.data.model.Message
import com.vxin.app.data.model.ReplyPreview
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

private const val HISTORY_PAGE = 50   // 与 MessageApi.history 默认 limit 一致

/** 上传中的占位项（成功后被真实 Message 替换） */
data class PendingUpload(
    val tempId: String,
    val type: String,            // image | voice | video | file
    val name: String,
    val localUri: String? = null, // 图片本地预览
    val failed: Boolean = false,
    val retry: (suspend () -> Message)? = null, // 失败后重试用的上传动作
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
    val background: String = "",      // 聊天专属背景图 URL（空=无）
    val closed: Boolean = false,      // 被踢/群解散 → 关闭聊天页
    val loadingEarlier: Boolean = false,
    val reachedStart: Boolean = false,   // 已加载到最早
    val stickers: List<com.vxin.app.data.model.Sticker> = emptyList(),
    val groupMembers: List<com.vxin.app.data.model.GroupMember> = emptyList(),
    val pinnedMessages: List<com.vxin.app.data.model.PinnedMessage> = emptyList(),
    val forwardTargets: List<com.vxin.app.data.model.Conversation> = emptyList(),  // 转发可选会话
    // ── 会话内消息搜索 ──
    val searchActive: Boolean = false,
    val searchQuery: String = "",
    val searching: Boolean = false,
    val searchResults: List<Message> = emptyList(),
    // ── 多选（批量撤回/删除）──
    val multiSelect: Boolean = false,
    val selectedIds: Set<String> = emptySet(),
    // ── 红包 ──
    val redPacketDetail: RedPacketDetail? = null,   // 非空 = 显示红包详情弹窗
    val redPacketLoading: Boolean = false,
    val claimedAmount: Int? = null,                 // 刚领取到的金额（一次性提示）
    val sendingRedPacket: Boolean = false,          // 发红包进行中，防连点重复扣币
    val claimingRedPacket: Boolean = false,         // 抢红包进行中，防连点重复领取
    val error: String? = null,
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    private val stickerRepository: com.vxin.app.data.repository.StickerRepository,
    private val redPacketRepository: RedPacketRepository,
    private val callManager: com.vxin.app.core.call.CallManager,
    private val groupCallManager: com.vxin.app.core.call.GroupCallManager,
    private val groupRepository: com.vxin.app.data.repository.GroupRepository,
    private val momentRepository: com.vxin.app.data.repository.MomentRepository,
    private val mediaUploader: MediaUploader,
    private val audioRecorder: AudioRecorder,
    private val audioPlayer: AudioPlayer,
    private val mediaUrlResolver: MediaUrlResolver,
    private val draftStore: com.vxin.app.core.storage.DraftStore,
    private val outboxStore: com.vxin.app.core.storage.OutboxStore,
    sessionManager: SessionManager,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val conversationId: String = savedStateHandle.get<String>("conversationId").orEmpty()
    private val title: String = savedStateHandle.get<String>("title").orEmpty()
    val isGroup: Boolean = savedStateHandle.get<String>("type") == "group"
    private val savedPeerUserId: String = savedStateHandle.get<String>("peerUserId").orEmpty()

    val myId: String = (sessionManager.state.value as? AuthState.Authenticated)?.user?.id.orEmpty()

    // 进入会话即恢复上次未发送的草稿(对齐微信/Web)
    private val _uiState = MutableStateFlow(ChatUiState(title = title, loading = true, input = draftStore.get(conversationId)))
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻（错误与"已收藏/已转发"等成功提示共用 error 字段） */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    private var lastTypingEmit = 0L
    private var typingClearJob: Job? = null
    private val json = Json { ignoreUnknownKeys = true }

    init {
        chatRepository.joinConversation(conversationId)
        loadHistory()
        loadBackground()
        observeIncoming()
        observeTyping()
        observeRead()
        observeDeleted()
        observeCleared()
        observeReaction()
        observeEdited()
        observeRedPacketClaimed()
        observeConnection()
        if (isGroup) {
            loadPinned()
            observePinChanged()
            observeGroupGone()
            loadGroupMembers()
        }
    }

    // ── @提及 ──────────────────────────────────────────────
    private fun loadGroupMembers() {
        viewModelScope.launch {
            runCatching { groupRepository.info(conversationId).members }
                .onSuccess { list -> _uiState.update { it.copy(groupMembers = list.filterNot { m -> m.id == myId }) } }
        }
    }

    fun appendMention(member: com.vxin.app.data.model.GroupMember) {
        _uiState.update { it.copy(input = it.input + "@${member.username} ") }
        draftStore.set(conversationId, _uiState.value.input)   // @追加也存草稿
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
        if (_uiState.value.sendingRedPacket) return   // 资金操作：进行中禁止重复触发，防快速双击重复扣币
        _uiState.update { it.copy(sendingRedPacket = true) }
        viewModelScope.launch {
            runCatching { redPacketRepository.send(conversationId, totalAmount, totalCount, greeting.trim()) }
                .onSuccess { resp -> resp.message?.let { appendUnique(it) } } // 通常 socket 也会广播，appendUnique 去重
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("发送红包失败")) } }
            _uiState.update { it.copy(sendingRedPacket = false) }
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
        if (_uiState.value.claimingRedPacket) return   // 进行中禁止重复触发，防快速双击重复领取
        _uiState.update { it.copy(claimingRedPacket = true) }
        viewModelScope.launch {
            runCatching { redPacketRepository.claim(packetId) }
                .onSuccess { resp ->
                    _uiState.update { it.copy(claimedAmount = resp.amount) }
                    refreshRedPacketDetail(packetId)
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("手慢了，红包没抢到")) }; refreshRedPacketDetail(packetId) }
            _uiState.update { it.copy(claimingRedPacket = false) }
        }
    }

    fun closeRedPacket() = _uiState.update { it.copy(redPacketDetail = null, claimedAmount = null) }

    // ── 音视频通话 ─────────────────────────────────────────
    /** 私聊对方 userId：优先用导航传入的 peerUserId，其次从消息历史推断（兜底） */
    private fun peerId(): String? =
        savedPeerUserId.ifEmpty { null }
            ?: _uiState.value.messages.firstOrNull { it.sender_id != myId }?.sender_id

    /** 发起通话；无法确定对方（如群聊/无消息）返回 false */
    fun startCall(video: Boolean): Boolean {
        if (isGroup) return false
        val peer = peerId()
        if (peer == null) {
            // 拿不到对方 userId（导航未传 peerUserId 且历史无对方消息）→ 明确提示，避免"点了没反应"
            _uiState.update { it.copy(error = "无法发起通话，请稍后重试") }
            return false
        }
        callManager.startCall(peer, _uiState.value.title, video)
        return true
    }

    /** 发起群通话（mesh）。仅群聊有效。 */
    fun startGroupCall(video: Boolean): Boolean {
        if (!isGroup) return false
        groupCallManager.start(conversationId, video)
        return true
    }

    // ── 拍一拍 ─────────────────────────────────────────────
    /** 拍一拍某人（双击头像）。系统会广播 type='nudge' 消息，经 incomingMessages 回流入列表。 */
    fun nudge(targetId: String) {
        if (targetId == myId) return
        chatRepository.nudge(conversationId, targetId)
    }

    /** 解析 nudge 消息为展示文案：「你/X 拍了拍 你/Y」 */
    fun nudgeText(msg: Message): String {
        val o = runCatching { json.parseToJsonElement(msg.content) }.getOrNull()
        val obj = (o as? kotlinx.serialization.json.JsonObject)
        fun str(k: String) = (obj?.get(k) as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
        val actor = str("actor"); val target = str("target")
        val actorName = if (actor == myId) "你" else str("actorName").ifEmpty { "某人" }
        val targetName = if (target == myId) "你" else str("targetName").ifEmpty { "某人" }
        return "$actorName 拍了拍 $targetName"
    }

    // ── 聊天背景 ───────────────────────────────────────────
    private fun loadBackground() {
        viewModelScope.launch {
            runCatching { chatRepository.loadConversations().firstOrNull { it.id == conversationId }?.background }
                .onSuccess { bg -> if (!bg.isNullOrEmpty()) _uiState.update { it.copy(background = bg) } }
        }
    }

    /** 选定图片 → 上传得 URL → 设为本会话背景 */
    fun setBackground(uri: Uri) {
        viewModelScope.launch {
            val part = withContext(Dispatchers.IO) {
                runCatching { mediaUploader.prepareFromUri(uri, fieldName = "images")?.part }.getOrNull()
            } ?: run { _uiState.update { it.copy(error = "无法读取图片") }; return@launch }
            runCatching {
                val url = momentRepository.uploadImages(listOf(part)).firstOrNull().orEmpty()
                if (url.isEmpty()) error("上传失败")
                chatRepository.setConversationBackground(conversationId, url)
                url
            }
                .onSuccess { url -> _uiState.update { it.copy(background = url, error = "已设置聊天背景") } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("设置背景失败")) } }
        }
    }

    fun clearBackground() {
        viewModelScope.launch {
            runCatching { chatRepository.setConversationBackground(conversationId, "") }
                .onSuccess { _uiState.update { it.copy(background = "") } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("清除失败")) } }
        }
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
    fun appendEmoji(emoji: String) {
        _uiState.update { it.copy(input = it.input + emoji) }
        draftStore.set(conversationId, _uiState.value.input)   // 表情追加也存草稿
    }

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

    fun vanish(msg: Message) {
        viewModelScope.launch {
            chatRepository.vanishMessage(msg.id)
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("删除失败")) } }
        }
        // 实时事件 message_vanished 驱动列表更新
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
        viewModelScope.launch {
            chatRepository.messageVanishedEvents.collect { msgId ->
                _uiState.update { it.copy(messages = it.messages.filterNot { m -> m.id == msgId }) }
            }
        }
        viewModelScope.launch {
            chatRepository.batchDeletedEvents.collect { ids ->
                _uiState.update { it.copy(messages = it.messages.filterNot { m -> ids.contains(m.id) }) }
            }
        }
    }

    // 多端清空同步（对齐 web）：另一端清空了本会话 → 本端也清空消息列表
    private fun observeCleared() {
        viewModelScope.launch {
            chatRepository.conversationClearedEvents.collect { convId ->
                if (convId == conversationId) _uiState.update { it.copy(messages = emptyList()) }
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

    /** 是否可编辑：本人文本消息，不限时间 */
    fun canEdit(msg: Message): Boolean =
        msg.sender_id == myId && msg.type == "text"

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
                .onSuccess { list -> _uiState.update { it.copy(forwardTargets = list.filterNot { c -> c.id == conversationId }) } }
        }
    }

    // ── 会话内消息搜索 ──
    private var searchJob: Job? = null

    fun openSearch() = _uiState.update { it.copy(searchActive = true) }
    fun closeSearch() {
        searchJob?.cancel()
        _uiState.update { it.copy(searchActive = false, searchQuery = "", searchResults = emptyList(), searching = false) }
    }

    fun onSearchQueryChange(q: String) {
        _uiState.update { it.copy(searchQuery = q) }
        searchJob?.cancel()
        val kw = q.trim()
        if (kw.isEmpty()) {
            _uiState.update { it.copy(searchResults = emptyList(), searching = false) }
            return
        }
        _uiState.update { it.copy(searching = true) }
        searchJob = viewModelScope.launch {
            delay(300)   // 去抖
            runCatching { chatRepository.searchInConversation(conversationId, kw) }
                .onSuccess { list -> _uiState.update { it.copy(searching = false, searchResults = list) } }
                .onFailure { e -> _uiState.update { it.copy(searching = false, searchResults = emptyList(), error = e.toUserMessage("搜索失败")) } }
        }
    }

    // ── 多选（批量撤回/删除）──
    fun enterMultiSelect(first: Message) =
        _uiState.update { it.copy(multiSelect = true, selectedIds = setOf(first.id)) }

    fun exitMultiSelect() =
        _uiState.update { it.copy(multiSelect = false, selectedIds = emptySet()) }

    fun toggleSelect(msg: Message) = _uiState.update { s ->
        val next = if (msg.id in s.selectedIds) s.selectedIds - msg.id else s.selectedIds + msg.id
        s.copy(selectedIds = next)
    }

    fun batchDeleteSelected() {
        val ids = _uiState.value.selectedIds.toList()
        if (ids.isEmpty()) return
        viewModelScope.launch {
            runCatching { chatRepository.batchDelete(conversationId, ids) }
                .onSuccess {
                    // 本端乐观移除(广播 messages_batch_deleted 亦会移除，幂等)
                    _uiState.update { s -> s.copy(messages = s.messages.filterNot { it.id in ids }, multiSelect = false, selectedIds = emptySet()) }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("批量删除失败")) } }
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
                    // 合并本地待发件箱：上次发送失败且未成功的文本消息，切走/重启后仍在。
                    // 服务端可能已幂等落库(id==outbox 的 clientMsgId) → 已成功,剔除并清理。
                    val serverIds = list.mapTo(HashSet()) { it.id }
                    val pending = outboxStore.load(conversationId)
                    val stillPending = pending.filter { it.id !in serverIds }
                    pending.filterNot { it in stillPending }.forEach { outboxStore.remove(conversationId, it.id) }
                    val merged = (list + stillPending).sortedBy { it.created_at }
                    _uiState.update { it.copy(loading = false, messages = merged, reachedStart = list.size < HISTORY_PAGE) }
                    markReadLatest()   // 打开会话即标记已读
                    healFailedMessages()   // 连线且有失败气泡 → 进会话自动重发一次
                }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载消息失败")) } }
        }
    }

    /** 上滑加载更早消息（按最早一条的时间向前翻页） */
    fun loadEarlier() {
        val s = _uiState.value
        if (s.loadingEarlier || s.reachedStart || s.messages.isEmpty()) return
        val before = s.messages.first().created_at
        _uiState.update { it.copy(loadingEarlier = true) }
        viewModelScope.launch {
            runCatching { chatRepository.loadHistory(conversationId, before = before) }
                .onSuccess { older ->
                    _uiState.update { st ->
                        val existing = st.messages.map { it.id }.toSet()
                        val merged = older.filterNot { it.id in existing } + st.messages
                        st.copy(loadingEarlier = false, messages = merged, reachedStart = older.size < HISTORY_PAGE)
                    }
                }
                .onFailure { _uiState.update { it.copy(loadingEarlier = false) } }
        }
    }

    // 用户是否在消息列表底部附近(由 UI 更新)。看历史时收到新消息不立即标已读，
    // 避免对方过早看到「已读」；滚回底部后再补标(对齐微信/web)。
    @Volatile private var atBottom: Boolean = true

    fun setAtBottom(value: Boolean) {
        val was = atBottom
        atBottom = value
        if (value && !was) markReadLatest()   // 刚滚回底部：把在底看到的最新消息补标已读
    }

    private fun observeIncoming() {
        viewModelScope.launch {
            chatRepository.incomingMessages.collect { msg ->
                if (msg.conversation_id != conversationId) return@collect
                claimOrAppend(msg)
                // 仅在底部附近才即时标已读；看历史时留给「N 条新消息」提示，滚回底再标
                if (msg.sender_id != myId && atBottom) markReadLatest()
            }
        }
    }

    /**
     * 广播消息落地：若它是本端某条乐观气泡的回声（按 client_msg_id 认领），就替换那条
     * 乐观气泡（并清出待发件箱），避免「乐观 + 广播」双显；否则按 id 去重后追加。
     * 关键：即便发送时 ack 丢失(乐观转 failed)，只要广播带回同一 client_msg_id，也能自愈为成功。
     */
    private fun claimOrAppend(msg: Message) {
        val cid = msg.clientMsgId
        _uiState.update { state ->
            if (cid != null) {
                val idx = state.messages.indexOfFirst { it.clientMsgId == cid || it.id == cid }
                if (idx >= 0) {
                    outboxStore.remove(conversationId, state.messages[idx].id)
                    // 若真实消息已因其它路径存在，避免重复
                    val deduped = state.messages.filterIndexed { i, m -> i == idx || m.id != msg.id }
                    return@update state.copy(messages = deduped.map { if (it.clientMsgId == cid || it.id == cid) msg else it })
                }
            }
            if (state.messages.any { it.id == msg.id }) state
            else state.copy(messages = state.messages + msg)
        }
    }

    /** 断线重连后：自动自愈发送失败的文本气泡（弱网/电梯/地铁场景，对齐 Web） */
    private fun observeConnection() {
        viewModelScope.launch {
            var wasConnected = chatRepository.socketStatus.value == com.vxin.app.core.realtime.SocketStatus.CONNECTED
            chatRepository.socketStatus.collect { status ->
                val nowConnected = status == com.vxin.app.core.realtime.SocketStatus.CONNECTED
                if (nowConnected && !wasConnected) healFailedMessages()   // 从断开→连上
                wasConnected = nowConnected
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
        draftStore.set(conversationId, v)   // 持久化草稿(切走再回来仍在)
        // 节流：非空且距上次 emit > 2s 才发 typing，避免刷屏
        val now = System.currentTimeMillis()
        if (v.isNotBlank() && now - lastTypingEmit > 2000) {
            lastTypingEmit = now
            chatRepository.emitTyping(conversationId)
        }
    }

    fun send() {
        val text = _uiState.value.input.trim()
        if (text.isEmpty()) return
        val replyId = _uiState.value.replyingTo?.id
        // 幂等键：本次发送固定一个 clientMsgId；失败重发复用它，后端据 (sender_id, client_msg_id)
        // 去重，弱网重发/socket 重连补发都不产生重复气泡。同时作乐观消息的临时 id。
        val clientMsgId = java.util.UUID.randomUUID().toString()
        val replySnap = _uiState.value.replyingTo?.let {
            ReplyPreview(id = it.id, type = it.type, content = it.content, senderName = it.senderName)
        }
        // 立刻渲染「发送中」乐观气泡（对齐 Web），输入框即时清空，不再回填打断连续输入
        val optimistic = Message(
            id = clientMsgId,
            conversation_id = conversationId,
            sender_id = myId,
            type = "text",
            content = text,
            reply_to_id = replyId,
            created_at = System.currentTimeMillis() / 1000,
            replyTo = replySnap,
            localStatus = LocalMsgStatus.SENDING,
            clientMsgId = clientMsgId,
        )
        _uiState.update { it.copy(input = "", error = null, replyingTo = null, messages = it.messages + optimistic) }
        draftStore.clear(conversationId)
        chatRepository.emitStopTyping(conversationId)
        dispatchSend(optimistic)
    }

    /** 发送一条乐观消息并处理成功/失败落地；失败入待发件箱，可自动/手动重发。 */
    private fun dispatchSend(optimistic: Message) {
        val cid = optimistic.clientMsgId ?: optimistic.id
        // 标记为发送中（重发场景从 failed 回到 sending）
        replaceMessage(optimistic.id) { it.copy(localStatus = LocalMsgStatus.SENDING) }
        viewModelScope.launch {
            chatRepository.sendText(optimistic.conversation_id, optimistic.content, optimistic.reply_to_id, cid)
                .onSuccess { real ->
                    outboxStore.remove(conversationId, optimistic.id)
                    // 用真实消息替换乐观气泡（保留位置）；若真实消息已由广播先到，去重
                    _uiState.update { state ->
                        val withoutDup = state.messages.filterNot { it.id == real.id }
                        state.copy(messages = withoutDup.map { if (it.id == optimistic.id) real else it })
                    }
                }
                .onFailure {
                    replaceMessage(optimistic.id) { it.copy(localStatus = LocalMsgStatus.FAILED) }
                    outboxStore.upsert(conversationId, optimistic.copy(localStatus = LocalMsgStatus.FAILED))
                }
        }
    }

    /** 手动/自动重发一条失败的文本气泡 */
    fun retryMessage(msgId: String) {
        val msg = _uiState.value.messages.firstOrNull { it.id == msgId } ?: return
        if (msg.localStatus != LocalMsgStatus.FAILED) return
        dispatchSend(msg)
    }

    /** 就地替换某条消息（按 id） */
    private fun replaceMessage(id: String, transform: (Message) -> Message) {
        _uiState.update { state ->
            state.copy(messages = state.messages.map { if (it.id == id) transform(it) else it })
        }
    }

    /** 自动自愈：把当前所有 failed 文本气泡错峰重发（连线时调用） */
    private fun healFailedMessages() {
        if (chatRepository.socketStatus.value != com.vxin.app.core.realtime.SocketStatus.CONNECTED) return
        val failed = _uiState.value.messages.filter { it.localStatus == LocalMsgStatus.FAILED }
        if (failed.isEmpty()) return
        viewModelScope.launch {
            failed.forEachIndexed { i, m ->
                delay(i * 120L)   // 错峰，避免瞬时突发
                val cur = _uiState.value.messages.firstOrNull { it.id == m.id }
                if (cur?.localStatus == LocalMsgStatus.FAILED) dispatchSend(cur)
            }
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
            val replyId = _uiState.value.replyingTo?.id
            runUpload(pending) { chatRepository.uploadPrepared(conversationId, prepared, replyId) }
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
            val replyId = _uiState.value.replyingTo?.id
            runUpload(pending) { chatRepository.uploadPrepared(conversationId, prepared, replyId) }
        }
    }

    fun cancelRecording() {
        audioRecorder.cancel()
        _uiState.update { it.copy(recording = false) }
    }

    private fun runUpload(pending: PendingUpload, block: suspend () -> Message) {
        // 记住重试动作，失败后可一键重传
        addPending(pending.copy(retry = block))
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { msg -> removePending(pending.tempId); appendUnique(msg) }
                .onFailure { e ->
                    markPendingFailed(pending.tempId)
                    _uiState.update { it.copy(error = e.toUserMessage("上传失败")) }
                }
        }
    }

    /** 重试失败的上传项 */
    fun retryPending(tempId: String) {
        val p = _uiState.value.pending.firstOrNull { it.tempId == tempId } ?: return
        val block = p.retry ?: return
        // 重置为进行中
        _uiState.update { s -> s.copy(pending = s.pending.map { if (it.tempId == tempId) it.copy(failed = false) else it }, error = null) }
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { msg -> removePending(tempId); appendUnique(msg) }
                .onFailure { e ->
                    markPendingFailed(tempId)
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
