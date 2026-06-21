package com.vxin.app.data.repository

import com.vxin.app.core.storage.TokenStore
import com.vxin.app.data.api.AuthApi
import com.vxin.app.data.model.LoginRequest
import com.vxin.app.data.model.RegisterRequest
import com.vxin.app.data.model.User
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: AuthApi,
    private val tokenStore: TokenStore,
) {
    suspend fun login(phone: String, password: String): User {
        val res = api.login(LoginRequest(phone.trim(), password))
        tokenStore.token = res.token   // 先落盘，后续请求由 AuthInterceptor 自动带上
        return res.user
    }

    suspend fun register(phone: String, password: String, username: String): User {
        val res = api.register(RegisterRequest(phone.trim(), password, username.trim()))
        tokenStore.token = res.token
        return res.user
    }

    /** 启动时用已存 token 校验会话；token 不存在或失效返回 null */
    suspend fun restoreSession(): User? {
        if (!tokenStore.isLoggedIn) return null
        return runCatching { api.me() }.getOrNull()
    }

    suspend fun logout() {
        runCatching { api.logout() }   // best-effort 通知后端拉黑 token
        tokenStore.clear()
    }
}
