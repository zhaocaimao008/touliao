package com.touliao.app.core.network
import com.touliao.app.core.storage.ServerConfig
import com.touliao.app.core.storage.TokenStore
import com.touliao.app.core.storage.normalizedOrigin
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** Applied at both application and network boundaries: freeze identity, then check every redirect. */
@Singleton
class MediaAuthInterceptor @Inject constructor(private val server: ServerConfig, private val tokens: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val owner = request.tag(TokenStore.Snapshot::class.java) ?: tokens.snapshot()
        if (!tokens.isCurrent(owner)) throw IOException("媒体所属账号已切换")
        val base = server.baseUrl.toHttpUrlOrNull()
        val sameOrigin = base != null && owner.origin == normalizedOrigin(request.url.toString()) &&
            request.url.scheme == base.scheme && request.url.host == base.host && request.url.port == base.port
        if (sameOrigin && request.header("Authorization") != null && request.header("Authorization") != "Bearer ${owner.token}") throw IOException("媒体所属账号已切换")
        val builder = request.newBuilder().tag(TokenStore.Snapshot::class.java, owner)
        if (!sameOrigin) builder.removeHeader("Authorization")
        else if (request.url.encodedPath.startsWith("/uploads/")) {
            builder.removeHeader("Authorization")
            owner.token?.let { builder.header("Authorization", "Bearer $it") }
        }
        val response = chain.proceed(builder.build())
        if (!tokens.isCurrent(owner)) { response.close(); throw IOException("媒体所属账号已切换") }
        return response
    }
}
