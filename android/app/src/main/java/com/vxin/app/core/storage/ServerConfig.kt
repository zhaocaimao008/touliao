package com.vxin.app.core.storage

import android.content.Context
import com.vxin.app.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 服务器地址配置。默认取 BuildConfig.DEFAULT_SERVER_URL，
 * 运行时可在 App 内切换并持久化（对齐 Web 端 localStorage 'vxin_server_url'）。
 * 切换后由 HostSelectionInterceptor 在请求时动态改写 host，无需重建 Retrofit。
 */
@Singleton
class ServerConfig @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("vxin_server", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, null)?.takeIf { it.isNotBlank() }
            ?: BuildConfig.DEFAULT_SERVER_URL
        set(value) {
            prefs.edit().putString(KEY_BASE_URL, normalize(value)).apply()
        }

    /** 供 Retrofit 初始化用：保证以 '/' 结尾 */
    fun baseUrlWithSlash(): String = normalize(baseUrl) + "/"

    private fun normalize(url: String): String = url.trim().trimEnd('/')

    private companion object {
        const val KEY_BASE_URL = "base_url"
    }
}
