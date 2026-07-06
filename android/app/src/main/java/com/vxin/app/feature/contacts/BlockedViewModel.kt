package com.vxin.app.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.BlockedUser
import com.vxin.app.data.repository.ContactRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class BlockedUiState(
    val loading: Boolean = true,
    val users: List<BlockedUser> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class BlockedViewModel @Inject constructor(
    private val contactRepository: ContactRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(BlockedUiState())
    val uiState: StateFlow<BlockedUiState> = _uiState.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    init { refresh() }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { contactRepository.blocked() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, users = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载黑名单失败")) } }
        }
    }

    fun unblock(user: BlockedUser) {
        viewModelScope.launch {
            runCatching { contactRepository.unblock(user.id) }
                .onSuccess { _uiState.update { s -> s.copy(users = s.users.filterNot { it.id == user.id }) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("移出黑名单失败")) } }
        }
    }
}
