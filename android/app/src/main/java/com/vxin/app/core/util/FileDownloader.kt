package com.vxin.app.core.util

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import android.widget.Toast
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 文件/视频：用系统 DownloadManager 后台下载到「下载」目录，完成后通知栏可直接点开对应应用。
 * 不用 ACTION_VIEW 打开 http 链接（那会跳浏览器/弹网页下载）。URL 需已带 ?token= 鉴权（见 MediaUrlResolver）。
 * 供聊天窗口与收藏等处共用。
 */
fun downloadFile(context: Context, url: String?, filename: String?) {
    if (url.isNullOrBlank()) return
    runCatching {
        val uri = Uri.parse(url)
        val name = downloadName(filename, uri)
        val ext = name.substringAfterLast('.', "").lowercase()
        val mime = if (ext.isNotBlank())
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) else null
        val req = DownloadManager.Request(uri)
            .setTitle(name)
            .setDescription("下载中…")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
        if (mime != null) req.setMimeType(mime)
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        dm.enqueue(req)
        Toast.makeText(context, "开始下载：$name（完成后可在通知栏点开）", Toast.LENGTH_SHORT).show()
    }.onFailure {
        Toast.makeText(context, "下载失败：${it.message ?: "未知错误"}", Toast.LENGTH_SHORT).show()
    }
}

/**
 * 保存聊天图片到系统相册（Pictures/vxin）。
 * 用 MediaStore Insert API，Android 10+（scoped storage）无需 WRITE_EXTERNAL_STORAGE 权限即可写公共相册；
 * Android 9 及以下 MediaStore 同样可用（走传统路径由系统处理）。
 * url 需已带 ?token= 鉴权（见 MediaUrlResolver）。
 */
suspend fun saveImageToGallery(context: Context, url: String?, filename: String? = null) {
    if (url.isNullOrBlank()) return
    withContext(Dispatchers.IO) {
        runCatching {
            // 用 Coil 走应用已有的鉴权/缓存栈拉取原图字节
            val request = ImageRequest.Builder(context)
                .data(url)
                .allowHardware(false)
                .build()
            val result = context.imageLoader.execute(request)
            if (result !is SuccessResult) {
                throw IllegalStateException("图片加载失败")
            }
            val bitmap = (result.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap
                ?: throw IllegalStateException("无法获取图片数据")

            val name = downloadName(filename, Uri.parse(url)).let {
                if (it.contains('.')) it else "$it.jpg"
            }
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/vxin")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("无法创建相册文件")
            resolver.openOutputStream(uri)?.use { out ->
                bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 95, out)
            } ?: throw IllegalStateException("无法写入相册文件")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }
        }.onSuccess {
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "图片已保存到相册", Toast.LENGTH_SHORT).show()
            }
        }.onFailure {
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "保存失败：${it.message ?: "未知错误"}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}

/**
 * 复制聊天图片到系统剪贴板，可直接粘贴到微信/QQ/备忘录等应用。
 * 做法：Coil 取原图(走应用鉴权栈) → PNG 落 cache/clipboard → FileProvider 授出 content:// URI →
 * ClipData.newUri 写剪贴板，并附 grantUriPermission 让接收方可读。
 * 直接写 file:// 或 bitmap 是不行的：Android 剪贴板跨应用只认 content:// 且需授权。
 * url 需已带 ?token= 鉴权（见 MediaUrlResolver）。
 */
suspend fun copyImageToClipboard(context: Context, url: String?) {
    if (url.isNullOrBlank()) return
    withContext(Dispatchers.IO) {
        runCatching {
            val request = ImageRequest.Builder(context)
                .data(url)
                .allowHardware(false)   // 需读取像素做 PNG 压缩，硬件位图不可读
                .build()
            val result = context.imageLoader.execute(request)
            if (result !is SuccessResult) throw IllegalStateException("图片加载失败")
            val bitmap = (result.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap
                ?: throw IllegalStateException("无法获取图片数据")

            // 落到 cache/clipboard（file_paths.xml 的 cache-path 已覆盖），固定单文件避免堆积
            val dir = java.io.File(context.cacheDir, "clipboard").apply { mkdirs() }
            val file = java.io.File(dir, "copy_image.png")
            java.io.FileOutputStream(file).use { out ->
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out)
            }

            val uri = androidx.core.content.FileProvider.getUriForFile(
                context, "${context.packageName}.fileprovider", file
            )
            val clip = android.content.ClipData.newUri(context.contentResolver, "图片", uri)
            // 授权粘贴方读取该 URI（部分 ROM 不读 ClipData 自带 flag，此处显式补授）
            clip.description.extras = android.os.PersistableBundle().apply {
                putBoolean("isSensitive", false)
            }
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            cm.setPrimaryClip(clip)
            uri
        }.onSuccess { uri ->
            withContext(Dispatchers.Main) {
                runCatching {
                    // 对已知常用接收方补授读权限，提升兼容性（失败不影响主流程）
                    context.grantUriPermission(
                        context.packageName, uri,
                        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                }
                // Android 13+ 系统自带复制提示，避免重复 Toast
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    Toast.makeText(context, "图片已复制", Toast.LENGTH_SHORT).show()
                }
            }
        }.onFailure {
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "复制失败：${it.message ?: "未知错误"}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}

/** 选定下载文件名：优先用原始文件名；无名/无扩展名则用 URL 末段(uuid.ext)补全；并清洗非法字符。 */
private fun downloadName(filename: String?, url: Uri): String {
    val urlName = url.lastPathSegment.orEmpty()
    val base = filename?.trim().orEmpty()
    val chosen = when {
        base.isNotBlank() && base.contains('.') -> base
        base.isNotBlank() && urlName.contains('.') -> base + "." + urlName.substringAfterLast('.')
        urlName.isNotBlank() -> urlName
        else -> "file_" + System.currentTimeMillis()
    }
    return chosen.replace(Regex("[/\\\\:*?\"<>|\\x00-\\x1f]"), "_").take(120)
}
