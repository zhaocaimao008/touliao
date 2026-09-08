package com.touliao.app.core.auth

import com.touliao.app.core.di.AppScope
import com.touliao.app.core.network.AuthInterceptor
import com.touliao.app.core.realtime.SocketManager
import com.touliao.app.data.model.User
import com.touliao.app.data.repository.AuthRepository
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
    private val pushManager: com.touliao.app.core.push.PushManager,
    private val remoteConfig: com.touliao.app.core.config.RemoteConfig,
    private val tokenStore: com.touliao.app.core.storage.TokenStore,
    private val accountStore: com.touliao.app.core.storage.AccountStore,
    private val msgCacheStore: com.touliao.app.core.storage.MsgCacheStore,
    authInterceptor: AuthInterceptor,
    @AppScope private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<AuthState>(AuthState.Loading)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    init {
        scope.launch {
            authInterceptor.unauthorizedEvents.collect { marker ->
                tokenStore.withCurrent(marker) {
                    socketManager.disconnect()
                    msgCacheStore.clear()
                    _state.value = AuthState.Unauthenticated
                }
            }
        }
        // 先拉远程配置确定服务器地址，再恢复会话（确保后续请求/Socket 用对地址）
        scope.launch {
            remoteConfig.refresh()
            restoreSession()
        }
    }

    suspend fun restoreSession() {
        val credential = tokenStore.snapshot()
        val user = authRepository.restoreSession()
        tokenStore.withCurrent(credential) {
            if (user != null) {
                socketManager.connect()
                pushManager.registerCurrentToken()
                _state.value = AuthState.Authenticated(user)
            } else {
                _state.value = AuthState.Unauthenticated
            }
        }
    }

    fun onAuthenticated(user: User) {
        if (accountStore.activeId() != user.id) return
        tokenStore.beginIdentityChange()
        // 添加账号/切号场景：Token 已换新，强制断开旧 Socket 再按新 Token 重连，避免跨账号串线
        socketManager.disconnect()
        msgCacheStore.clear()          // 账号级缓存隔离：先清缓存再连接，避免新连接消息被误清
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
    fun accounts(): List<com.touliao.app.data.model.Account> = accountStore.accounts()
    fun activeAccountId(): String? = accountStore.activeId()

    /** 移除非当前账号（当前账号请用退出登录） */
    fun removeAccount(accountId: String) {
        if (accountId != accountStore.activeId()) accountStore.remove(accountId)
    }

    /** 切换到已登录的另一账号（本地有 token，免重登） */
    fun switchAccount(accountId: String) {
        val token = accountStore.tokenFor(accountId) ?: return
        tokenStore.beginIdentityChange()
        _state.value = AuthState.Loading
        val operation = tokenStore.snapshot()
        scope.launch {
            if (!tokenStore.isCurrent(operation)) return@launch
            pushManager.unregisterCurrentToken()   // 须在覆盖 tokenStore.token 之前调用，否则会用新账号身份去删旧账号的 token（见 AUDIT.md 十四节"串号推送"）
            if (!tokenStore.withCurrent(operation) {
                socketManager.disconnect()
                accountStore.setActive(accountId)
                tokenStore.token = token
                msgCacheStore.clear()
                socketManager.connect()
                pushManager.registerCurrentToken()
            }) return@launch
            restoreSession()
        }
    }

    /** 改密后应用新签发的 token：覆盖当前 Bearer token 与本账号已存 token，避免旧 token 失效被登出。 */
    fun credentialSnapshot() = tokenStore.snapshot()
    fun isCredentialCurrent(snapshot: com.touliao.app.core.storage.TokenStore.Snapshot) = tokenStore.isCurrent(snapshot)
    fun applyNewToken(token: String, expected: com.touliao.app.core.storage.TokenStore.Snapshot): Boolean {
        if (token.isBlank()) return false
        return tokenStore.installReplacement(expected, token) {
            accountStore.activeId()?.let { accountStore.updateToken(it, token) }
            socketManager.disconnect()
            socketManager.connect()
        }
    }

    /** 注销账户成功后本地收尾：与 logout 一致清理，回到登录页。 */
    suspend fun deleteAccount() {
        tokenStore.beginIdentityChange()
        val credential = tokenStore.snapshot()
        pushManager.unregisterCurrentToken()   // 须在清 auth token 前
        tokenStore.withCurrent(credential) {
        socketManager.disconnect()
        tokenStore.clear()
        msgCacheStore.clear()                  // 离线消息缓存全清（隐私红线）
        accountStore.activeId()?.let { accountStore.remove(it) }
        _state.value = AuthState.Unauthenticated
        }
    }

    suspend fun logout() {
        tokenStore.beginIdentityChange()
        val credential = tokenStore.snapshot()
        pushManager.unregisterCurrentToken()   // 须在清 auth token 前
        if (!tokenStore.isCurrent(credential)) return
        socketManager.disconnect()
        val marker = authRepository.logout() ?: return
        tokenStore.withCurrent(marker) {
            msgCacheStore.clear()
            _state.value = AuthState.Unauthenticated
        }
    }
}
