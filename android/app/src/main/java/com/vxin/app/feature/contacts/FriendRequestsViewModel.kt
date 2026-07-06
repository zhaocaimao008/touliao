package com.vxin.app.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.FriendRequest
import com.vxin.app.data.model.SentRequest
import com.vxin.app.data.repository.ContactRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FriendRequestsUiState(
    val loading: Boolean = false,
    val requests: List<FriendRequest> = emptyList(),
    val sent: List<SentRequest> = emptyList(),
    val handling: Set<String> = emptySet(),
    val error: String? = null,
)

@HiltViewModel
class FriendRequestsViewModel @Inject constructor(
    private val contactRepository: ContactRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FriendRequestsUiState(loading = true))
    val uiState: StateFlow<FriendRequestsUiState> = _uiState.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    init {
        refresh()
        viewModelScope.launch { contactRepository.friendEvents.collect { refresh() } }
    }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { contactRepository.receivedRequests() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, requests = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载失败")) } }
            runCatching { contactRepository.sentRequests() }
                .onSuccess { list -> _uiState.update { it.copy(sent = list) } }
        }
    }

    fun handle(request: FriendRequest, accept: Boolean) {
        if (request.id in _uiState.value.handling) return
        _uiState.update { it.copy(handling = it.handling + request.id) }
        viewModelScope.launch {
            runCatching { contactRepository.handleRequest(request.id, accept) }
                .onSuccess {
                    // 处理完从列表移除
                    _uiState.update { it.copy(requests = it.requests.filterNot { r -> r.id == request.id }, handling = it.handling - request.id) }
                }
                .onFailure { e -> _uiState.update { it.copy(handling = it.handling - request.id, error = e.toUserMessage("操作失败")) } }
        }
    }
}
