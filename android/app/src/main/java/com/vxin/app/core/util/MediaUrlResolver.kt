package com.vxin.app.core.util

import com.vxin.app.core.storage.ServerConfig
import com.vxin.app.core.storage.TokenStore
import java.net.URLEncoder
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 把后端相对资源路径（/uploads/...）解析为可被 Coil/播放器加载的绝对地址。
 * 受保护的 /uploads 资源无法在请求头携带 Bearer（图片/媒体加载器不走我们的 OkHttp），
 * 故对其附加 ?token=（后端兜底鉴权，对齐 Web 端 url.js 的做法）。
 */
@Singleton
class MediaUrlResolver @Inject constructor(
    private val serverConfig: ServerConfig,
    private val tokenStore: TokenStore,
) {
    fun resolve(url: String?): String? {
        if (url.isNullOrBlank()) return url
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url

        val base = serverConfig.baseUrl.trimEnd('/')
        var abs = if (url.startsWith("/")) "$base$url" else "$base/$url"

        val token = tokenStore.token
        if (!token.isNullOrBlank() && abs.contains("/uploads/")) {
            val sep = if (abs.contains("?")) "&" else "?"
            abs += "${sep}token=${URLEncoder.encode(token, "UTF-8")}"
        }
        return abs
    }
}
