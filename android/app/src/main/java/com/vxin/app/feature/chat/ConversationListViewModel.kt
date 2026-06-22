package com.vxin.app.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.AuthState
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.realtime.SocketStatus
import com.vxin.app.data.model.Conversation
import com.vxin.app.data.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ConversationListUiState(
    val loading: Boolean = false,
    val conversations: List<Conversation> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class ConversationListViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val myId: String =
        (sessionManager.state.value as? AuthState.Authenticated)?.user?.id.orEmpty()

    val socketStatus: StateFlow<SocketStatus> =
        chatRepository.socketStatus.stateIn(
            viewModelScope, SharingStarted.WhileSubscribed(5000), SocketStatus.DISCONNECTED,
        )

    private val _uiState = MutableStateFlow(ConversationListUiState(loading = true))
    val uiState: StateFlow<ConversationListUiState> = _uiState.asStateFlow()

    init {
        refresh()
        observeIncoming()
        observeReconnect()
        observeUnreadCleared()
        observeNewConversation()
    }

    /** 被拉入群聊/新会话 → 整表刷新 */
    private fun observeNewConversation() {
        viewModelScope.launch {
            chatRepository.newConversationEvents.collect { refresh() }
        }
    }

    /** 本人已读某会话（本端或其他端）→ 清零未读 */
    private fun observeUnreadCleared() {
        viewModelScope.launch {
            chatRepository.unreadClearedEvents.collect { convId ->
                _uiState.update { state ->
                    val idx = state.conversations.indexOfFirst { it.id == convId }
                    if (idx < 0 || state.conversations[idx].unreadCount == 0) return@update state
                    val list = state.conversations.toMutableList()
                    list[idx] = list[idx].copy(unreadCount = 0)
                    state.copy(conversations = list)
                }
            }
        }
    }

    // ── 会话操作：置顶/免打扰/清空 ──
    fun togglePin(conv: Conversation) {
        val pinned = conv.pinned != 1
        viewModelScope.launch {
            runCatching { chatRepository.setConversationPinned(conv.id, pinned) }
                .onSuccess { refresh() }   // 重拉以重新排序（置顶靠前）
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("操作失败")) } }
        }
    }

    fun toggleMute(conv: Conversation) {
        val muted = conv.muted != 1
        viewModelScope.launch {
            runCatching { chatRepository.setConversationMuted(conv.id, muted) }
                .onSuccess {
                    _uiState.update { s -> s.copy(conversations = s.conversations.map { if (it.id == conv.id) it.copy(muted = if (muted) 1 else 0) else it }) }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("操作失败")) } }
        }
    }

    fun clearMessages(conv: Conversation) {
        viewModelScope.launch {
            runCatching { chatRepository.clearMessages(conv.id) }
                .onSuccess {
                    _uiState.update { s -> s.copy(conversations = s.conversations.map { if (it.id == conv.id) it.copy(lastMessage = null, lastMessageType = null) else it }) }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("清空失败")) } }
        }
    }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { chatRepository.loadConversations() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, conversations = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载会话失败")) } }
        }
    }

    /** 新消息到达：就地更新对应会话的最后消息/时间/未读，并置顶 */
    private fun observeIncoming() {
        viewModelScope.launch {
            chatRepository.incomingMessages.collect { msg ->
                _uiState.update { state ->
                    val list = state.conversations.toMutableList()
                    val idx = list.indexOfFirst { it.id == msg.conversation_id }
                    if (idx < 0) return@update state   // 未在列表中（新会话）暂忽略，下次刷新可见
                    val old = list.removeAt(idx)
                    val updated = old.copy(
                        lastMessage = msg.content,
                        lastMessageType = msg.type,
                        lastTime = msg.created_at,
                        unreadCount = if (msg.sender_id != myId) old.unreadCount + 1 else old.unreadCount,
                    )
                    list.add(0, updated)
                    state.copy(conversations = list)
                }
            }
        }
    }

    /** 断线重连成功后整表重拉，纠正离线期间的差异（StateFlow 自带去重） */
    private fun observeReconnect() {
        viewModelScope.launch {
            socketStatus.collect { status ->
                if (status == SocketStatus.CONNECTED) refresh()
            }
        }
    }

    fun logout() {
        viewModelScope.launch { sessionManager.logout() }
    }
}
