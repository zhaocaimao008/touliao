package com.vxin.app.core.config

import android.util.Log
import com.vxin.app.core.storage.ServerConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
data class RemoteConfigDto(
    val api: String = "",
    val socket: String = "",
    val cdn: String = "",
    val version: String = "",
)

/**
 * 远程配置（永不重编译换服务器）。启动时从 CONFIG_URLS 依次拉取 config.json，
 * 取其中的 api 地址写入 ServerConfig.remote。换服务器只需改 config.json。
 *
 * CONFIG_URLS 是唯一编译进 App 的常量（稳定的引导地址），与 Web 端保持一致。
 * 用独立 OkHttpClient（不走鉴权/HostSelection 拦截器，避免被改写 host）。
 */
@Singleton
class RemoteConfig @Inject constructor(
    private val serverConfig: ServerConfig,
    private val json: Json,
) {
    private val client = OkHttpClient.Builder()
        .callTimeout(6, TimeUnit.SECONDS)
        .build()

    /** 拉取并应用远程服务器地址；失败则保留上次缓存/默认。在网络请求前调用一次。 */
    suspend fun refresh() = withContext(Dispatchers.IO) {
        for (url in CONFIG_URLS) {
            val api = runCatching { fetchApi(url) }.getOrNull()
            if (!api.isNullOrBlank()) {
                serverConfig.setRemote(api)
                Log.i(TAG, "remote server = $api (from $url)")
                return@withContext
            }
        }
        Log.w(TAG, "远程配置不可达，沿用上次/默认地址: ${serverConfig.baseUrl}")
    }

    private fun fetchApi(url: String): String? {
        client.newCall(Request.Builder().url(url).build()).execute().use { res ->
            if (!res.isSuccessful) return null
            val body = res.body?.string() ?: return null
            val cfg = json.decodeFromString<RemoteConfigDto>(body)
            val api = cfg.api.ifBlank { cfg.socket }
            return api.ifBlank { null }
        }
    }

    companion object {
        private const val TAG = "RemoteConfig"
        // 引导地址（稳定，唯一编译常量）；与 web/src/utils/config.js 一致
        val CONFIG_URLS = listOf(
            "https://cdn.jsdelivr.net/gh/zhaocaimao008/vxin-config@main/config.json",
            "https://dipsin.com/config.json",
        )
    }
}
