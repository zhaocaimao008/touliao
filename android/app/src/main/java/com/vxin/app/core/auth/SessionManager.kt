package com.vxin.app.core.auth

import com.vxin.app.core.di.AppScope
import com.vxin.app.core.network.AuthInterceptor
import com.vxin.app.core.realtime.SocketManager
import com.vxin.app.data.model.User
import com.vxin.app.data.repository.AuthRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

sealed interface AuthState {
    data object Loading : AuthState
    data object Unauthenticated : AuthState
    data class Authenticated(val user: User) : AuthState
}

/**
 * 全局会话状态的单一事实来源。
 * - 启动即 restoreSession（凭已存 token 调 /me）
 * - 订阅 AuthInterceptor 的 401 事件 → 自动登出
 * - 登录成功 / 登出由 ViewModel 调用更新
 */
@Singleton
class SessionManager @Inject constructor(
    private val authRepository: AuthRepository,
    private val socketManager: SocketManager,
    private val pushManager: com.vxin.app.core.push.PushManager,
    private val remoteConfig: com.vxin.app.core.config.RemoteConfig,
    private val tokenStore: com.vxin.app.core.storage.TokenStore,
    private val accountStore: com.vxin.app.core.storage.AccountStore,
    private val msgCacheStore: com.vxin.app.core.storage.MsgCacheStore,
    authInterceptor: AuthInterceptor,
    @AppScope private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<AuthState>(AuthState.Loading)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    init {
        scope.launch {
            authInterceptor.unauthorizedEvents.collect {
                socketManager.disconnect()
                msgCacheStore.clear()   // 401 被动登出也清离线缓存（隐私红线）
                _state.value = AuthState.Unauthenticated
            }
        }
        // 先拉远程配置确定服务器地址，再恢复会话（确保后续请求/Socket 用对地址）
        scope.launch {
            remoteConfig.refresh()
            restoreSession()
        }
    }

    suspend fun restoreSession() {
        val user = authRepository.restoreSession()
        if (user != null) {
            socketManager.connect()
            pushManager.registerCurrentToken()
            _state.value = AuthState.Authenticated(user)
        } else {
            _state.value = AuthState.Unauthenticated
        }
    }

    fun onAuthenticated(user: User) {
        socketManager.connect()
        pushManager.registerCurrentToken()
        _state.value = AuthState.Authenticated(user)
    }

    /** 资料更新后刷新当前用户（不改变登录态） */
    fun updateCurrentUser(user: User) {
        if (_state.value is AuthState.Authenticated) _state.value = AuthState.Authenticated(user)
    }

    val currentUser: User? get() = (_state.value as? AuthState.Authenticated)?.user

    // ── 多账号 ──────────────────────────────────────────
    fun accounts(): List<com.vxin.app.data.model.Account> = accountStore.accounts()
    fun activeAccountId(): String? = accountStore.activeId()

    /** 移除非当前账号（当前账号请用退出登录） */
    fun removeAccount(accountId: String) {
        if (accountId != accountStore.activeId()) accountStore.remove(accountId)
    }

    /** 切换到已登录的另一账号（本地有 token，免重登） */
    fun switchAccount(accountId: String) {
        val token = accountStore.tokenFor(accountId) ?: return
        scope.launch {
            socketManager.disconnect()
            accountStore.setActive(accountId)
            tokenStore.token = token
            socketManager.connect()
            pushManager.registerCurrentToken()
            restoreSession()
        }
    }

    /** 改密后应用新签发的 token：覆盖当前 Bearer token 与本账号已存 token，避免旧 token 失效被登出。 */
    fun applyNewToken(token: String) {
        if (token.isBlank()) return
        tokenStore.token = token
        accountStore.activeId()?.let { accountStore.updateToken(it, token) }
    }

    /** 注销账户成功后本地收尾：与 logout 一致清理，回到登录页。 */
    suspend fun deleteAccount() {
        pushManager.unregisterCurrentToken()   // 须在清 auth token 前
        socketManager.disconnect()
        tokenStore.clear()
        msgCacheStore.clear()                  // 离线消息缓存全清（隐私红线）
        accountStore.activeId()?.let { accountStore.remove(it) }
        _state.value = AuthState.Unauthenticated
    }

    suspend fun logout() {
        pushManager.unregisterCurrentToken()   // 须在清 auth token 前
        socketManager.disconnect()
        authRepository.logout()
        msgCacheStore.clear()                  // 离线消息缓存全清（隐私红线：登出/切账号）
        _state.value = AuthState.Unauthenticated
    }
}
