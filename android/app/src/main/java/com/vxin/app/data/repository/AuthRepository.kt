package com.vxin.app.data.repository

import com.vxin.app.core.storage.AccountStore
import com.vxin.app.core.storage.TokenStore
import com.vxin.app.data.api.AuthApi
import com.vxin.app.data.model.Account
import com.vxin.app.data.model.LoginRequest
import com.vxin.app.data.model.RegisterRequest
import com.vxin.app.data.model.User
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: AuthApi,
    private val tokenStore: TokenStore,
    private val accountStore: AccountStore,
) {
    suspend fun login(phone: String, password: String): User {
        val res = api.login(LoginRequest(phone.trim(), password))
        applyAuth(res.token, res.user)
        return res.user
    }

    suspend fun register(phone: String, password: String, username: String): User {
        val res = api.register(RegisterRequest(phone.trim(), password, username.trim()))
        applyAuth(res.token, res.user)
        return res.user
    }

    /** 登录成功:落 active token + 记入多账号列表 */
    private fun applyAuth(token: String, user: User) {
        tokenStore.token = token
        accountStore.upsertActive(Account(user.id, user.username, user.avatar, token))
    }

    /** 启动时用已存 token 校验会话；token 不存在或失效返回 null */
    suspend fun restoreSession(): User? {
        if (!tokenStore.isLoggedIn) return null
        return runCatching { api.me() }.getOrNull()
    }

    suspend fun logout() {
        runCatching { api.logout() }   // best-effort 通知后端拉黑 token
        accountStore.activeId()?.let { accountStore.remove(it) }
        tokenStore.clear()
    }
}
