package com.touliao.app.feature.callhistory

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.core.util.MediaUrlResolver
import com.touliao.app.data.model.CallLog
import com.touliao.app.data.repository.ContactRepository
import com.touliao.app.data.repository.ProfileRepository
import com.touliao.app.feature.contacts.ConversationTarget
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
    private val callManager: CallManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CallHistoryUiState())
    val uiState: StateFlow<CallHistoryUiState> = _uiState.asStateFlow()

    // 点击通话记录 → 打开对方会话(回拨/继续聊天)，一次性事件
    private val _openChat = MutableStateFlow<ConversationTarget?>(null)
    val openChat: StateFlow<ConversationTarget?> = _openChat.asStateFlow()
    fun consumeOpenChat() { _openChat.value = null }

    fun consumeError() = _uiState.update { it.copy(error = null) }
    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    init {
        refresh()
        // 通话结束事件驱动刷新:CallManager stage 从通话中(非 IDLE/ENDED)回到
        // IDLE/ENDED 时重新拉取——停留在历史页时挂断/拒绝/超时后列表自动出现新记录
        viewModelScope.launch {
            var prevStage: CallStage? = null
            callManager.state.collect { s ->
                val cur = s.stage
                val wasInCall = prevStage != null && prevStage != CallStage.IDLE && prevStage != CallStage.ENDED
                val nowIdle = cur == CallStage.IDLE || cur == CallStage.ENDED
                if (wasInCall && nowIdle) refresh(silent = true)
                prevStage = cur
            }
        }
    }

    fun openPeerChat(log: CallLog) {
        if (log.kind == "group") {
            val convId = log.conversation_id ?: return
            _openChat.value = ConversationTarget(convId, log.peer_name.ifBlank { "群聊" })
            return
        }
        val peerId = log.peer_id
        if (peerId.isNullOrBlank()) return
        viewModelScope.launch {
            runCatching { contactRepository.createPrivate(peerId) }
                .onSuccess { convId -> _openChat.value = ConversationTarget(convId, log.peer_name.ifBlank { "聊天" }, peerId) }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("打开聊天失败")) } }
        }
    }

    fun refresh(silent: Boolean = false) {
        if (!silent) _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { profileRepository.callLogs() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, items = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载通话记录失败")) } }
        }
    }
}
