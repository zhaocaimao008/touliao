package com.touliao.app.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.core.config.RemoteConfig
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.core.storage.ServerConfig
import com.touliao.app.data.api.ConfigApi
import com.touliao.app.data.repository.AuthRepository
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
    // 企业代码：查目录表拿到该客户自己的服务器地址后直接切换，不需要用户知道完整域名。
    // 与上面手动输入 serverUrl 是并存的两条路径，互不干扰。
    val tenantCode: String = "",
    val resolvingTenantCode: Boolean = false,
    val tenantCodeStatus: String? = null,
    val loading: Boolean = false,
    val loggedIn: Boolean = false,   // 成功后用于「添加账号」流程返回
    val error: String? = null,
    // 图形验证码：是否要求由后台开关 features.loginCaptcha 决定（GET /api/config），
    // 默认 false（不要求），避免开关拉取失败时误挡住所有人登录。
    val captchaRequired: Boolean = false,
    val captchaId: String = "",
    val captchaSvgDataUrl: String = "",
    val captchaText: String = "",
) {
    val canSubmit: Boolean get() = phone.isNotBlank() && password.isNotBlank() && !loading &&
        (!captchaRequired || captchaText.isNotBlank())
}

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val sessionManager: SessionManager,
    private val serverConfig: ServerConfig,
    private val configApi: ConfigApi,
    private val remoteConfig: RemoteConfig,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState(serverUrl = serverConfig.baseUrl))
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            runCatching { configApi.getConfig() }
                .onSuccess { cfg ->
                    val on = cfg.features.loginCaptcha
                    _uiState.update { it.copy(captchaRequired = on) }
                    if (on) loadCaptcha()
                }
            // 拉取失败保持默认（不要求验证码），后端仍会最终裁决
        }
    }

    fun onPhoneChange(v: String) = _uiState.update { it.copy(phone = v, error = null) }
    fun onPasswordChange(v: String) = _uiState.update { it.copy(password = v, error = null) }
    fun onServerUrlChange(v: String) = _uiState.update { it.copy(serverUrl = v) }
    fun onTenantCodeChange(v: String) = _uiState.update { it.copy(tenantCode = v, tenantCodeStatus = null) }
    fun onCaptchaTextChange(v: String) = _uiState.update { it.copy(captchaText = v, error = null) }

    fun loadCaptcha() {
        _uiState.update { it.copy(captchaText = "") }
        viewModelScope.launch {
            runCatching { authRepository.getCaptcha() }
                .onSuccess { r -> _uiState.update { it.copy(captchaId = r.captchaId, captchaSvgDataUrl = r.svgDataUrl) } }
                .onFailure { _uiState.update { it.copy(captchaId = "", captchaSvgDataUrl = "") } }
        }
    }

    /** 切换服务器地址：持久化，后续请求即生效（HostSelectionInterceptor 动态改写） */
    fun saveServerUrl() {
        val url = _uiState.value.serverUrl.trim()
        if (url.isNotEmpty()) serverConfig.baseUrl = url
    }

    /** 按企业代码解析并切换服务器；[onResolved] 在成功时回调，供 UI 收起输入框。 */
    fun resolveTenantCode(onResolved: () -> Unit) {
        val code = _uiState.value.tenantCode
        _uiState.update { it.copy(resolvingTenantCode = true, tenantCodeStatus = null) }
        viewModelScope.launch {
            val entry = remoteConfig.resolveCode(code)
            if (entry == null) {
                _uiState.update { it.copy(resolvingTenantCode = false, tenantCodeStatus = "找不到该企业代码，请确认后重试") }
                return@launch
            }
            _uiState.update { it.copy(serverUrl = entry.api) }
            saveServerUrl()
            _uiState.update {
                it.copy(
                    resolvingTenantCode = false,
                    tenantCodeStatus = entry.name.takeIf { n -> n.isNotBlank() }?.let { n -> "已连接「$n」" },
                )
            }
            onResolved()
        }
    }

    fun submit() {
        val s = _uiState.value
        if (!s.canSubmit) return
        saveServerUrl()
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                authRepository.login(
                    s.phone, s.password,
                    captchaId = if (s.captchaRequired) s.captchaId else null,
                    captchaText = if (s.captchaRequired) s.captchaText else null,
                )
            }
                .onSuccess { user ->
                    _uiState.update { it.copy(loading = false, loggedIn = true) }
                    sessionManager.onAuthenticated(user)   // 触发全局状态切到主页
                }
                .onFailure { e ->
                    val msg = e.toUserMessage("登录失败")
                    _uiState.update { it.copy(loading = false, error = msg) }
                    // 验证码一次核销即失效（不管猜对猜错），报错后旧图必然已经作废，直接换一张
                    if (s.captchaRequired && msg.contains("验证码")) loadCaptcha()
                }
        }
    }
}
