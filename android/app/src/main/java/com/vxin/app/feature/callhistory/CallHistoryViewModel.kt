package com.vxin.app.feature.callhistory

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.util.MediaUrlResolver
import com.vxin.app.data.model.CallLog
import com.vxin.app.data.repository.ContactRepository
import com.vxin.app.data.repository.ProfileRepository
import com.vxin.app.feature.contacts.ConversationTarget
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CallHistoryUiState(
    val loading: Boolean = true,
    val items: List<CallLog> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class CallHistoryViewModel @Inject constructor(
    private val profileRepository: ProfileRepository,
    private val contactRepository: ContactRepository,
    private val mediaUrlResolver: MediaUrlResolver,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CallHistoryUiState())
    val uiState: StateFlow<CallHistoryUiState> = _uiState.asStateFlow()

    // 点击通话记录 → 打开对方会话(回拨/继续聊天)，一次性事件
    private val _openChat = MutableStateFlow<ConversationTarget?>(null)
    val openChat: StateFlow<ConversationTarget?> = _openChat.asStateFlow()
    fun consumeOpenChat() { _openChat.value = null }

    fun consumeError() = _uiState.update { it.copy(error = null) }
    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    init { refresh() }

    fun openPeerChat(log: CallLog) {
        if (log.peer_id.isBlank()) return
        viewModelScope.launch {
            runCatching { contactRepository.createPrivate(log.peer_id) }
                .onSuccess { convId -> _openChat.value = ConversationTarget(convId, log.peer_name.ifBlank { "聊天" }, log.peer_id) }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("打开聊天失败")) } }
        }
    }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { profileRepository.callLogs() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, items = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载通话记录失败")) } }
        }
    }
}
