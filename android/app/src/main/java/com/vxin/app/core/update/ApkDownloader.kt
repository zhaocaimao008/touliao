package com.vxin.app.core.update

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okio.buffer
import okio.sink
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** 下载进度回调 */
fun interface DownloadProgress {
    fun onProgress(bytesRead: Long, contentLength: Long, percent: Float)
}

/**
 * APK 下载器。下载到 app 专属外部目录（getExternalFilesDir("downloads")），
 * 无需公共存储权限。下载完成后返回本地 File。
 */
@Singleton
class ApkDownloader @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS) // 大文件下载需较长超时
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /** APK 文件名（固定，每次覆盖） */
    private val apkFileName = "vxin-update.apk"

    /** 下载目录 */
    private val downloadDir: File
        get() = File(context.getExternalFilesDir(null), "downloads").also { it.mkdirs() }

    /**
     * 下载 APK 到本地。
     * @param url  APK 直链
     * @param progress  进度回调（下载线程调用）
     * @return 下载完成的本地文件
     * @throws IOException 网络/IO 异常
     */
    suspend fun download(
        url: String,
        progress: DownloadProgress? = null,
    ): File = withContext(Dispatchers.IO) {
        val target = File(downloadDir, apkFileName)
        // 断点续传：如果已有文件先删掉，避免安装陈旧的 APK
        if (target.exists()) target.delete()

        Log.i(TAG, "开始下载 APK: $url → $target")
        val request = Request.Builder().url(url).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("下载失败 HTTP ${response.code}")
            }

            val body = response.body ?: throw IOException("空响应体")
            val contentLength = body.contentLength()
            var bytesRead = 0L

            target.sink().buffer().use { sink ->
                val buffer = okio.Buffer()
                val source = body.source()
                while (true) {
                    val read = source.read(buffer, 8192)
                    if (read == -1L) break
                    bytesRead += read
                    sink.write(buffer, read)

                    progress?.onProgress(bytesRead, contentLength,
                        if (contentLength > 0) (bytesRead.toFloat() / contentLength) * 100f else 0f)
                }
            }
        }

        if (!target.exists() || target.length() == 0L) {
            throw IOException("下载文件为空")
        }
        Log.i(TAG, "APK 下载完成: ${target.absolutePath} (${target.length()} bytes)")
        target
    }

    companion object {
        private const val TAG = "ApkDownloader"
    }
}
