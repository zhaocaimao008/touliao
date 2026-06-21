package com.vxin.app.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.User
import com.vxin.app.data.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MyQrUiState(
    val loading: Boolean = true,
    val qr: ByteArray? = null,
    val user: User? = null,
    val error: String? = null,
)

@HiltViewModel
class MyQrCodeViewModel @Inject constructor(
    private val profileRepository: ProfileRepository,
    sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MyQrUiState(user = sessionManager.currentUser))
    val uiState: StateFlow<MyQrUiState> = _uiState.asStateFlow()

    init { load() }

    fun load() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { profileRepository.qrcodeBytes() }
                .onSuccess { bytes -> _uiState.update { it.copy(loading = false, qr = bytes) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("二维码加载失败")) } }
        }
    }
}
