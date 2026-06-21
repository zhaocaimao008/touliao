package com.vxin.app.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.QrPayload
import com.vxin.app.data.model.SearchUser
import com.vxin.app.data.repository.ContactRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import javax.inject.Inject

data class AddFriendUiState(
    val query: String = "",
    val searching: Boolean = false,
    val results: List<SearchUser> = emptyList(),
    val sentIds: Set<String> = emptySet(),     // 已发送/已加 的用户 id
    val message: String? = null,               // 提示（成功/失败）
    val searched: Boolean = false,
)

@HiltViewModel
class AddFriendViewModel @Inject constructor(
    private val contactRepository: ContactRepository,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AddFriendUiState())
    val uiState: StateFlow<AddFriendUiState> = _uiState.asStateFlow()

    private val json = Json { ignoreUnknownKeys = true }

    /** 扫码结果：解析 vxin 二维码并发起好友申请 */
    fun addByQrPayload(raw: String) {
        val payload = runCatching { json.decodeFromString<QrPayload>(raw) }.getOrNull()
        if (payload == null || payload.type != "vxin-user" || payload.id.isBlank()) {
            _uiState.update { it.copy(message = "无法识别的二维码") }
            return
        }
        if (payload.id == sessionManager.currentUser?.id) {
            _uiState.update { it.copy(message = "这是你自己的二维码") }
            return
        }
        viewModelScope.launch {
            runCatching { contactRepository.sendFriendRequest(payload.id, "") }
                .onSuccess { resp ->
                    _uiState.update {
                        it.copy(
                            sentIds = it.sentIds + payload.id,
                            message = if (resp.autoAccepted) "已添加为好友" else "好友申请已发送",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(message = e.toUserMessage("添加失败")) } }
        }
    }

    fun onQueryChange(v: String) = _uiState.update { it.copy(query = v, message = null) }

    fun search() {
        val q = _uiState.value.query.trim()
        if (q.isEmpty() || _uiState.value.searching) return
        _uiState.update { it.copy(searching = true, message = null) }
        viewModelScope.launch {
            runCatching { contactRepository.search(q) }
                .onSuccess { list -> _uiState.update { it.copy(searching = false, results = list, searched = true) } }
                .onFailure { e -> _uiState.update { it.copy(searching = false, message = e.toUserMessage("搜索失败")) } }
        }
    }

    fun sendRequest(user: SearchUser) {
        viewModelScope.launch {
            runCatching { contactRepository.sendFriendRequest(user.id, "") }
                .onSuccess { resp ->
                    _uiState.update {
                        it.copy(
                            sentIds = it.sentIds + user.id,
                            message = if (resp.autoAccepted) "已添加为好友" else "好友申请已发送",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(message = e.toUserMessage("发送失败")) } }
        }
    }
}
