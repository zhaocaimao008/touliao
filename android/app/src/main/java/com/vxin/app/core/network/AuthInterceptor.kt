package com.vxin.app.core.network

import com.vxin.app.core.storage.TokenStore
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

        if (response.code == 401) {
            tokenStore.clear()
            _unauthorized.tryEmit(Unit)
        }
        return response
    }
}
