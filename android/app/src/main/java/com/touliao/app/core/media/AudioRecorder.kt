package com.touliao.app.core.media

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 简单语音录制：输出 MPEG-4/AAC（.m4a，audio/mp4），匹配后端允许的音频类型。
 * 需先获得 RECORD_AUDIO 运行时权限。
 */
@Singleton
class AudioRecorder @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var startedAtMs: Long = 0

    val mimeType: String = "audio/mp4"

    /** 2026-08-29新增：最近一次成功stop()的录音时长(秒，向下取整)。语音消息此前完全没有
     * 时长信息——聊天气泡只能显示固定"🎙 语音"文字，现在需要真实秒数渲染时长气泡。 */
    var lastDurationSeconds: Int = 0
        private set

    fun start(): Boolean {
        stopInternal(deleteFile = true)
        val file = File(context.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
        outputFile = file
        var r: MediaRecorder? = null
        lastDurationSeconds = 0
        return try {
            val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
            r = device
            device.setAudioSource(MediaRecorder.AudioSource.MIC)
            device.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            device.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            device.setAudioEncodingBitRate(64_000)
            device.setAudioSamplingRate(44_100)
            device.setOutputFile(file.absolutePath)
            device.prepare()
            device.start()
            recorder = device
            startedAtMs = android.os.SystemClock.elapsedRealtime()
            true
        } catch (e: Exception) {
            Log.e(TAG, "录音初始化失败")
            runCatching { r?.release() }
            recorder = null
            file.delete()
            outputFile = null
            false
        }
    }

    /** 停止并返回录音文件；失败返回 null */
    fun stop(): File? {
        val r = recorder ?: return null
        return try {
            r.stop()
            recorder = null
            lastDurationSeconds = ((android.os.SystemClock.elapsedRealtime() - startedAtMs) / 1000).toInt().coerceAtLeast(0)
            outputFile
        } catch (e: Exception) {
            Log.e(TAG, "录音失败")
            recorder = null
            outputFile?.delete()
            outputFile = null
            null
        } finally {
            runCatching { r.release() }
            recorder = null
        }
    }

    fun cancel() = stopInternal(deleteFile = true)

    private fun stopInternal(deleteFile: Boolean) {
        recorder?.let { runCatching { it.stop() }; runCatching { it.release() } }
        recorder = null
        if (deleteFile) { outputFile?.delete(); outputFile = null }
    }

    private companion object { const val TAG = "AudioRecorder" }
}
