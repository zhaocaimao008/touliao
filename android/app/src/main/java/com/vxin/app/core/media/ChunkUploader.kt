package com.vxin.app.core.media

import com.vxin.app.data.api.MessageApi
import com.vxin.app.data.model.ChunkConflictResponse
import com.vxin.app.data.model.Message
import com.vxin.app.data.model.UploadFinishBody
import com.vxin.app.data.model.UploadInitBody
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.HttpException
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.min

/**
 * 大文件分片 / 断点续传上传，对齐 Web 端 upload-init → upload-chunk → upload-finish。
 */
@Singleton
class ChunkUploader @Inject constructor(
    private val api: MessageApi,
    private val json: Json,
) {
    companion object {
        /** 与 Web 一致：超过 8MB 走分片通道 */
        const val CHUNK_THRESHOLD = 8L * 1024 * 1024
        private const val MAX_RETRIES = 3
    }

    suspend fun upload(
        conversationId: String,
        file: File,
        displayName: String,
        mime: String,
        replyToId: String? = null,
        onProgress: ((Int) -> Unit)? = null,
    ): Message {
        val hash = sha256(file)
        val init = api.uploadInit(
            conversationId,
            UploadInitBody(displayName, file.length(), hash, mime),
        )
        var received = init.received
        val chunkSize = init.chunkSize
        val total = file.length()

        RandomAccessFile(file, "r").use { raf ->
            while (received < total) {
                val len = min(chunkSize, total - received).toInt()
                val buf = ByteArray(len)
                raf.seek(received)
                raf.readFully(buf)
                received = putChunkWithRetry(conversationId, init.uploadId, received, buf)
                onProgress?.invoke((received * 100 / total).toInt().coerceIn(0, 100))
            }
        }

        return api.uploadFinish(
            conversationId,
            init.uploadId,
            UploadFinishBody(reply_to_id = replyToId),
        )
    }

    private suspend fun putChunkWithRetry(
        conversationId: String,
        uploadId: String,
        offset: Long,
        data: ByteArray,
    ): Long {
        var attempt = 0
        var currentOffset = offset
        while (true) {
            try {
                val body = data.toRequestBody("application/octet-stream".toMediaType())
                val resp = api.uploadChunk(conversationId, uploadId, currentOffset, body)
                return resp.received
            } catch (e: HttpException) {
                if (e.code() == 409) {
                    parseConflictReceived(e)?.let { return it }
                }
                if (++attempt >= MAX_RETRIES) throw e
                kotlinx.coroutines.delay(500L * attempt)
            }
        }
    }

    private fun parseConflictReceived(e: HttpException): Long? = runCatching {
        val raw = e.response()?.errorBody()?.string().orEmpty()
        json.decodeFromString<ChunkConflictResponse>(raw).received
    }.getOrNull()

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(8192)
            var n: Int
            while (input.read(buf).also { n = it } > 0) {
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}