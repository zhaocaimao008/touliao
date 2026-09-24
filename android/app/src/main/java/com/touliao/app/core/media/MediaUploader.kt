package com.touliao.app.core.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
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
        /** 2026-08-29新增：语音/视频时长(秒)，0表示未知。传给后端渲染真实时长气泡用。 */
        val durationSeconds: Int = 0,
    )

    /** 从相册/文件选择器返回的 Uri 准备上传（IO 操作，请在 Dispatchers.IO 调用） */
    fun prepareFromUri(uri: Uri, fieldName: String = "file"): Prepared? {
        val resolver = context.contentResolver
        val name = queryDisplayName(uri) ?: "file_${System.currentTimeMillis()}"
        // 部分文件选择器对 .heic 报 octet-stream，按扩展名补全，才能走下面的转码
        val mime = resolver.getType(uri)?.takeUnless { it == "application/octet-stream" }
            ?: when (name.substringAfterLast('.', "").lowercase()) {
                "heic" -> "image/heic"
                "heif" -> "image/heif"
                else -> "application/octet-stream"
            }
        val tmp = File(context.cacheDir, "upload_${System.currentTimeMillis()}_$name")
        resolver.openInputStream(uri)?.use { input ->
            tmp.outputStream().use { input.copyTo(it) }
        } ?: return null
        val jpeg = transcodeIfNeeded(tmp, mime)
        return if (jpeg != null) {
            tmp.delete()
            buildPart(jpeg, "image/jpeg", ImageUploadPolicy.jpegName(name), fieldName)
        } else {
            buildPart(tmp, mime, name, fieldName)
        }
    }

    /**
     * HEIC/HEIF 等非通用格式、或超过服务端像素上限的图片 → 长边 ≤ 4096 的 JPEG（见 [ImageUploadPolicy]）。
     * 不需要转码或本机无法解码时返回 null，按原文件上传。
     */
    private fun transcodeIfNeeded(src: File, mime: String): File? = runCatching {
        if (!mime.startsWith("image/")) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(src.path, bounds)
        // 读不出尺寸（如 Android 9 以下的 HEIC）时仍对非通用格式尝试转码，由解码结果决定
        if (!ImageUploadPolicy.needsTranscode(mime, maxOf(bounds.outWidth, 0), maxOf(bounds.outHeight, 0))) return null
        val bitmap = decodeScaled(src, bounds.outWidth, bounds.outHeight) ?: return null
        val out = File(context.cacheDir, "upload_${System.currentTimeMillis()}_${src.nameWithoutExtension}.jpg")
        try {
            out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, ImageUploadPolicy.JPEG_QUALITY, it) }
        } finally {
            bitmap.recycle()
        }
        out
    }.getOrNull()

    private fun decodeScaled(src: File, width: Int, height: Int): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // ImageDecoder 支持 HEIF，并自动按 EXIF 方向旋转
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(src)) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val (w, h) = ImageUploadPolicy.targetSize(info.size.width, info.size.height)
                decoder.setTargetSize(w, h)
            }
        }
        if (width <= 0 || height <= 0) return null
        val opts = BitmapFactory.Options().apply { inSampleSize = ImageUploadPolicy.sampleSize(width, height) }
        var bitmap = BitmapFactory.decodeFile(src.path, opts) ?: return null
        val (w, h) = ImageUploadPolicy.targetSize(bitmap.width, bitmap.height)
        if (w != bitmap.width || h != bitmap.height) {
            bitmap = Bitmap.createScaledBitmap(bitmap, w, h, true).also { if (it !== bitmap) bitmap.recycle() }
        }
        // 重新编码会丢 EXIF，方向必须先落到像素上
        val degrees = runCatching {
            when (ExifInterface(src.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        }.getOrDefault(0f)
        if (degrees == 0f) return bitmap
        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees) }, true)
        if (rotated !== bitmap) bitmap.recycle()
        return rotated
    }

    /** 录音等已落地的本地文件直接准备上传 */
    fun prepareFromFile(file: File, mime: String, displayName: String, durationSeconds: Int = 0): Prepared =
        buildPart(file, mime, displayName, "file", durationSeconds)

    private fun buildPart(file: File, mime: String, displayName: String, fieldName: String, durationSeconds: Int = 0): Prepared {
        val body = file.asRequestBody(mime.toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData(fieldName, displayName, body)
        val type = when {
            mime.startsWith("image/") -> "image"
            mime.startsWith("audio/") -> "voice"
            mime.startsWith("video/") -> "video"
            else -> "file"
        }
        return Prepared(part, displayName, type, file, mime, durationSeconds)
    }

    private fun queryDisplayName(uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()
}