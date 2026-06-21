package com.vxin.app.core.network

import com.vxin.app.core.storage.ServerConfig
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 运行时动态改写请求的 scheme/host/port 为当前配置的服务器地址，
 * 使「切换服务器」无需重建 Retrofit 实例即可生效。请求 path 保持不变。
 */
@Singleton
class HostSelectionInterceptor @Inject constructor(
    private val serverConfig: ServerConfig,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val target = serverConfig.baseUrl.toHttpUrlOrNull()
            ?: return chain.proceed(request)

        val newUrl = request.url.newBuilder()
            .scheme(target.scheme)
            .host(target.host)
            .port(target.port)
            .build()

        return chain.proceed(request.newBuilder().url(newUrl).build())
    }
}
