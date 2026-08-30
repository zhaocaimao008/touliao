package com.touliao.app.data.repository

import com.touliao.app.core.storage.AccountStore
import com.touliao.app.core.storage.TokenStore
import com.touliao.app.data.api.AuthApi
import com.touliao.app.data.model.Account
import com.touliao.app.data.model.CaptchaResponse
import com.touliao.app.data.model.LoginRequest
import com.touliao.app.data.model.RegisterRequest
import com.touliao.app.data.model.ResetPasswordRequest
import com.touliao.app.data.model.User
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: AuthApi,
    private val tokenStore: TokenStore,
    private val accountStore: AccountStore,
) {
    suspend fun login(phone: String, password: String, captchaId: String? = null, captchaText: String? = null): User {
        val res = api.login(LoginRequest(phone.trim(), password, captchaId, captchaText))
        applyAuth(res.token, res.user)
        return res.user
    }

    suspend fun getCaptcha(): CaptchaResponse = api.getCaptcha()

    suspend fun register(phone: String, password: String, username: String, inviteCode: String): User {
        val res = api.register(RegisterRequest(phone.trim(), password, username.trim(), inviteCode.trim()))
        applyAuth(res.token, res.user)
        return res.user
    }

    private fun applyAuth(token: String, user: User) {
        tokenStore.token = token
        accountStore.upsertActive(Account(user.id, user.username, user.avatar, token))
    }

    suspend fun restoreSession(): User? {
        if (!tokenStore.isLoggedIn) return null
        return runCatching { api.me() }.getOrNull()
    }

    suspend fun logout() {
        runCatching { api.logout() }
        accountStore.activeId()?.let { accountStore.remove(it) }
        tokenStore.clear()
    }

    suspend fun resetPassword(phone: String, inviteCode: String, newPassword: String) {
        api.resetPassword(
            ResetPasswordRequest(
                phone = phone.trim(),
                inviteCode = inviteCode.trim(),
                newPassword = newPassword,
            ),
        )
    }
}
