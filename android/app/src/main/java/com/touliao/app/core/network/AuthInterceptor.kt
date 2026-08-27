package com.touliao.app.core.network

import com.touliao.app.core.storage.TokenStore
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 为每个请求自动注入 Authorization: Bearer <token>。
 * 命中 401 时清除本地 token 并广播事件，由 SessionManager 订阅后踢回登录页。
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenStore: TokenStore,
) : Interceptor {

    private val _unauthorized = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val unauthorizedEvents: SharedFlow<Unit> = _unauthorized

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val request = tokenStore.token?.let { token ->
            original.newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        } ?: original

        val response = chain.proceed(request)

        // 业务 401 保护：登录/注册/找回密码/重置密码等 auth 端点的 401 是「业务失败」
        // （如密码错误），不是 token 失效——绝不能触发全局登出，否则「添加账号」流程
        // 输错一次密码就把当前已登录账号的 token/离线缓存全部清掉（数据丢失级事故）。
        // 只有受保护 API 的 401 才视为 token 失效。
        if (response.code == 401 && !isAuthEndpoint(original.url.encodedPath)) {
            tokenStore.clear()
            _unauthorized.tryEmit(Unit)
        }
        return response
    }

    /** auth 类端点：401 是业务语义（密码错误等），不触发全局登出。 */
    private fun isAuthEndpoint(path: String): Boolean {
        return path.startsWith("/api/auth/")
    }
}
