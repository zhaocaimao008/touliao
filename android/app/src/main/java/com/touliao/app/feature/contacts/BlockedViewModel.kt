package com.touliao.app.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.core.util.MediaUrlResolver
import com.touliao.app.data.model.BlockedUser
import com.touliao.app.data.repository.ContactRepository
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
    private val socialSocket: com.touliao.app.core.realtime.SocketManager,
    private val socialTokens: com.touliao.app.core.storage.TokenStore,
    private val contactRepository: ContactRepository,
    private val mediaUrlResolver: MediaUrlResolver,
) : ViewModel() {

    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    private val socialGuard = com.touliao.app.core.realtime.SocialReadGuard(
        { socialTokens.snapshot().identityEpoch }, { socialSocket.socialRevision.value })
    private val _uiState = MutableStateFlow(BlockedUiState())
    val uiState: StateFlow<BlockedUiState> = _uiState.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    init {
        viewModelScope.launch { socialSocket.socialRevision.collect { refresh() } }
 refresh() }

    fun refresh() {
        val stamp = socialGuard.begin() ?: return
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { contactRepository.blocked() }
                .onSuccess { list -> if (!socialGuard.current(stamp)) return@onSuccess; _uiState.update { it.copy(loading = false, users = list) } }
                .onFailure { e -> if (!socialGuard.current(stamp)) return@onFailure; _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载黑名单失败")) } }
        }
    }

    fun unblock(user: BlockedUser) {
        viewModelScope.launch {
            runCatching { contactRepository.unblock(user.id) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("移出黑名单失败")) } }
        }
    }
}
