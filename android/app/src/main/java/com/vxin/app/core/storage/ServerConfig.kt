package com.vxin.app.core.storage

import android.content.Context
import com.vxin.app.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 服务器地址（永不重编译换服务器）。
 * 生效优先级：手动切换(调试) > 远程 config.json > 编译内置默认。
 *  - 手动覆盖：登录页「切换服务器」写入，最高优先级
 *  - 远程：RemoteConfig 启动时从 config.json 拉取写入
 *  - 默认：BuildConfig.DEFAULT_SERVER_URL（仅在远程+无覆盖时兜底）
 */
@Singleton
class ServerConfig @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("vxin_server", Context.MODE_PRIVATE)

    /** 生效地址（读时计算优先级）；setter 写入「手动覆盖」 */
    var baseUrl: String
        get() = manualOverride() ?: remote() ?: BuildConfig.DEFAULT_SERVER_URL
        set(value) {
            prefs.edit().putString(KEY_OVERRIDE, normalize(value)).apply()
        }

    /** 供 Retrofit 初始化用：保证以 '/' 结尾 */
    fun baseUrlWithSlash(): String = normalize(baseUrl) + "/"

    /** RemoteConfig 写入远程地址（不覆盖用户的手动切换） */
    fun setRemote(url: String) {
        val n = normalize(url)
        if (n.isNotEmpty()) prefs.edit().putString(KEY_REMOTE, n).apply()
    }

    /** 清除手动覆盖，回到远程/默认 */
    fun clearManualOverride() = prefs.edit().remove(KEY_OVERRIDE).apply()

    private fun manualOverride(): String? = prefs.getString(KEY_OVERRIDE, null)?.takeIf { it.isNotBlank() }
    private fun remote(): String? = prefs.getString(KEY_REMOTE, null)?.takeIf { it.isNotBlank() }

    private fun normalize(url: String): String = url.trim().trimEnd('/')

    private companion object {
        const val KEY_OVERRIDE = "base_url_override"
        const val KEY_REMOTE = "base_url_remote"
    }
}
