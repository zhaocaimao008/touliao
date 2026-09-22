package com.touliao.app.core.util

import com.touliao.app.core.storage.ServerConfig
import com.touliao.app.core.storage.TokenStore
import com.touliao.app.core.di.DownloadHttpClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** URLs contain no account credentials. Images/downloads use headers; players use read tickets. */
@Singleton
class MediaUrlResolver @Inject constructor(
    private val serverConfig: ServerConfig,
    private val tokenStore: TokenStore,
    @DownloadHttpClient private val client: OkHttpClient,
) {
    fun resolve(url: String?): String? {
        if (url.isNullOrBlank() || url.startsWith("data:")) return url
        val base = serverConfig.baseUrl.trimEnd('/').toHttpUrlOrNull() ?: return null
        val resolved = base.resolve(url) ?: return null
        return if (resolved.encodedPath.startsWith("/uploads/"))
            resolved.newBuilder().removeAllQueryParameters("token").build().toString() else resolved.toString()
    }

    suspend fun ticket(raw: String): String = withContext(Dispatchers.IO) {
        val media = resolve(raw)?.toHttpUrlOrNull() ?: throw IOException("无效媒体地址")
        val base = serverConfig.baseUrl.toHttpUrlOrNull() ?: throw IOException("无效服务地址")
        if (media.scheme != base.scheme || media.host != base.host || media.port != base.port || !media.encodedPath.startsWith("/uploads/")) return@withContext media.toString()
        val owner = tokenStore.snapshot()
        val token = owner.token ?: throw IOException("请登录")
        val endpoint = base.newBuilder().encodedPath("/api/uploads/ticket").query(null).addQueryParameter("file", media.encodedPath).build()
        client.newCall(Request.Builder().url(endpoint).tag(TokenStore.Snapshot::class.java, owner).header("Authorization", "Bearer $token").build()).execute().use { response ->
            if (!response.isSuccessful || !tokenStore.isCurrent(owner)) throw IOException("媒体授权失败")
            val signed = base.resolve(JSONObject(response.body?.string() ?: "{}").getString("url")) ?: throw IOException("无效媒体票据")
            if (signed.scheme != base.scheme || signed.host != base.host || signed.port != base.port || signed.encodedPath != media.encodedPath || signed.queryParameter("token").isNullOrBlank()) throw IOException("无效媒体票据")
            signed.toString()
        }
    }
}
