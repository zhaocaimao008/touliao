package com.vxin.app.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.api.ConfigApi
import com.vxin.app.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RegisterUiState(
    val username: String = "",
    val phone: String = "",
    val password: String = "",
    val inviteCode: String = "",
    val inviteRequired: Boolean = true, // 由 /api/config 决定；拉取前保守视为需要
    val loading: Boolean = false,
    val error: String? = null,
) {
    val canSubmit: Boolean
        get() = username.isNotBlank() &&
            phone.isNotBlank() &&
            (!inviteRequired || inviteCode.length == 6) &&
            password.length >= 8 &&
            password.any(Char::isLetter) &&
            password.any(Char::isDigit) &&
            !loading
}

@HiltViewModel
class RegisterViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val sessionManager: SessionManager,
    private val configApi: ConfigApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(RegisterUiState())
    val uiState: StateFlow<RegisterUiState> = _uiState.asStateFlow()

    init {
        // 拉取后台开关；失败则保持默认（需要邀请码），后端仍会最终裁决。
        viewModelScope.launch {
            runCatching { configApi.getConfig() }
                .onSuccess { cfg -> _uiState.update { it.copy(inviteRequired = cfg.features.inviteRequired) } }
        }
    }

    fun onUsernameChange(v: String) = _uiState.update { it.copy(username = v, error = null) }
    fun onPhoneChange(v: String) = _uiState.update { it.copy(phone = v, error = null) }
    fun onPasswordChange(v: String) = _uiState.update { it.copy(password = v, error = null) }
    fun onInviteCodeChange(v: String) = _uiState.update { it.copy(inviteCode = v.filter(Char::isDigit).take(6), error = null) }

    fun submit() {
        val s = _uiState.value
        if (!s.canSubmit) return
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { authRepository.register(s.phone, s.password, s.username, s.inviteCode) }
                .onSuccess { user ->
                    _uiState.update { it.copy(loading = false) }
                    sessionManager.onAuthenticated(user)
                }
                .onFailure { e ->
                    _uiState.update { it.copy(loading = false, error = e.toUserMessage("注册失败")) }
                }
        }
    }
}
