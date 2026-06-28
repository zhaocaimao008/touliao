package com.vxin.app.core.media

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import dagger.hilt.android.qualifiers.ApplicationContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 把内容 Uri / 本地文件转换为可上传的 multipart part（字段名固定 file）。
 * 大文件通过临时文件流式上传，避免一次性读入内存。
 */
@Singleton
class MediaUploader @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    data class Prepared(
        val part: MultipartBody.Part,
        val displayName: String,
        /** image | voice | video | file —— 与后端按 MIME 推断保持一致，仅用于本地占位展示 */
        val localType: String,
        val file: File,
        val mime: String,
    )

    /** 从相册/文件选择器返回的 Uri 准备上传（IO 操作，请在 Dispatchers.IO 调用） */
    fun prepareFromUri(uri: Uri, fieldName: String = "file"): Prepared? {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        val name = queryDisplayName(uri) ?: "file_${System.currentTimeMillis()}"
        val tmp = File(context.cacheDir, "upload_${System.currentTimeMillis()}_$name")
        resolver.openInputStream(uri)?.use { input ->
            tmp.outputStream().use { input.copyTo(it) }
        } ?: return null
        return buildPart(tmp, mime, name, fieldName)
    }

    /** 录音等已落地的本地文件直接准备上传 */
    fun prepareFromFile(file: File, mime: String, displayName: String): Prepared =
        buildPart(file, mime, displayName, "file")

    private fun buildPart(file: File, mime: String, displayName: String, fieldName: String): Prepared {
        val body = file.asRequestBody(mime.toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData(fieldName, displayName, body)
        val type = when {
            mime.startsWith("image/") -> "image"
            mime.startsWith("audio/") -> "voice"
            mime.startsWith("video/") -> "video"
            else -> "file"
        }
        return Prepared(part, displayName, type, file, mime)
    }

    private fun queryDisplayName(uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()
}