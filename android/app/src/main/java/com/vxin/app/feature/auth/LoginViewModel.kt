package com.vxin.app.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.storage.ServerConfig
import com.vxin.app.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val phone: String = "",
    val password: String = "",
    val serverUrl: String = "",
    val loading: Boolean = false,
    val error: String? = null,
) {
    val canSubmit: Boolean get() = phone.isNotBlank() && password.isNotBlank() && !loading
}

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val sessionManager: SessionManager,
    private val serverConfig: ServerConfig,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState(serverUrl = serverConfig.baseUrl))
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onPhoneChange(v: String) = _uiState.update { it.copy(phone = v, error = null) }
    fun onPasswordChange(v: String) = _uiState.update { it.copy(password = v, error = null) }
    fun onServerUrlChange(v: String) = _uiState.update { it.copy(serverUrl = v) }

    /** 切换服务器地址：持久化，后续请求即生效（HostSelectionInterceptor 动态改写） */
    fun saveServerUrl() {
        val url = _uiState.value.serverUrl.trim()
        if (url.isNotEmpty()) serverConfig.baseUrl = url
    }

    fun submit() {
        val s = _uiState.value
        if (!s.canSubmit) return
        saveServerUrl()
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { authRepository.login(s.phone, s.password) }
                .onSuccess { user ->
                    _uiState.update { it.copy(loading = false) }
                    sessionManager.onAuthenticated(user)   // 触发全局状态切到主页
                }
                .onFailure { e ->
                    _uiState.update { it.copy(loading = false, error = e.toUserMessage("登录失败")) }
                }
        }
    }
}
