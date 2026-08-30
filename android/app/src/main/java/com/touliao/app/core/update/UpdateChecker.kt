package com.touliao.app.core.update

import android.util.Log
import com.touliao.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 远程版本检查器。用独立 OkHttpClient（不走 auth/host 拦截器），
 * 确保未登录 / 服务器地址错误时仍能拉取版本信息。
 *
 * 服务器上需部署 touliao-android-version.json，字段说明：
 *   versionCode  — BuildConfig.VERSION_CODE 比较用，大版本号数字
 *   versionName  — 人类可读版本名（如 "1.0.4"）
 *   url          — APK 下载直链
 *   notes        — 更新说明文案，支持多行 \n
 *   sha256       — APK 文件 SHA-256（小写十六进制），下载完成后 ApkDownloader 会校验
 */
@Singleton
class UpdateChecker @Inject constructor(
    private val json: Json,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /**
     * 远程版本清单 URL 列表（优先 CDN，兜底 touliao.cc 源站）。
     * 返回第一个能成功拉取并解析的结果。
     */
    private val CHECK_URLS = listOf(
        "https://touliao.cc/downloads/touliao-android-version.json",
    )

    /** 静默检查：返回结果不抛异常，适合启动时调用 */
    suspend fun check(): CheckResult = withContext(Dispatchers.IO) {
        for (url in CHECK_URLS) {
            val result = runCatching { fetchVersion(url) }
            if (result.isSuccess) {
                val dto = result.getOrThrow()
                if (dto.versionCode > BuildConfig.VERSION_CODE) {
                    Log.i(TAG, "发现新版本: ${dto.versionName} (${dto.versionCode})")
                    return@withContext CheckResult.Available(
                        versionCode = dto.versionCode,
                        versionName = dto.versionName,
                        url = dto.url,
                        notes = dto.notes,
                        sha256 = dto.sha256,
                    )
                } else {
                    // 结果都是安全的（不会触发下载），但 < 和 == 背后的含义不同：== 就是真的
                    // 已是最新版；< 意味着更新源返回了一个比当前还低的版本号，这本身是个可疑
                    // 信号（服务器被篡改/配置错误/降级攻击尝试），此前两种情况混在一起打同一条
                    // "已是最新版" info 日志，异常被悄悄吞掉、没有留痕，单独分支出来才能追踪。
                    if (dto.versionCode < BuildConfig.VERSION_CODE) {
                        Log.w(TAG, "更新源返回的版本号(${dto.versionCode})低于当前版本(${BuildConfig.VERSION_CODE})，疑似降级尝试，已忽略")
                    } else {
                        Log.i(TAG, "已是最新版: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                    }
                    return@withContext CheckResult.UpToDate
                }
            } else {
                Log.w(TAG, "拉取失败: $url — ${result.exceptionOrNull()?.message}")
            }
        }
        CheckResult.Failed("无法连接到更新服务器")
    }

    private fun fetchVersion(url: String): AppVersionDto {
        val request = Request.Builder().url(url).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw RuntimeException("HTTP ${response.code}")
            }
            val body = response.body?.string() ?: throw RuntimeException("空响应体")
            return json.decodeFromString<AppVersionDto>(body)
        }
    }

    companion object {
        private const val TAG = "UpdateChecker"
    }
}
