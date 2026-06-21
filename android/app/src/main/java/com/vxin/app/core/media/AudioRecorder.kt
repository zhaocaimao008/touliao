package com.vxin.app.core.media

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

    val mimeType: String = "audio/mp4"

    fun start(): Boolean {
        stopInternal(deleteFile = true)
        val file = File(context.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
        outputFile = file
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        return try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(64_000)
            r.setAudioSamplingRate(44_100)
            r.setOutputFile(file.absolutePath)
            r.prepare()
            r.start()
            recorder = r
            true
        } catch (e: Exception) {
            Log.e(TAG, "start failed: ${e.message}")
            runCatching { r.release() }
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
            r.release()
            recorder = null
            outputFile
        } catch (e: Exception) {
            Log.e(TAG, "stop failed: ${e.message}")
            r.release()
            recorder = null
            outputFile?.delete()
            outputFile = null
            null
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
