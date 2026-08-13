package com.touliao.app.core.util

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
            // 注意：ClipData.Description.setExtras() 是 API 33+，低版本勿调用，
            // 此处省略（不影响主流程：接收方通过 ClipData URI 即可读取）。
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

/**
 * 分享到第三方软件（微信/QQ/邮件等）：图片/视频/文件/文档。
 * 做法：先把资源落到 cache/share（图片走 Coil 复用鉴权栈；其它走 OkHttp 流式下载，
 *   url 需已带 ?token= 鉴权），再用 FileProvider 授出 content:// URI，
 *   最后 Intent.ACTION_SEND 拉起系统分享面板。
 * 不能直接分享 http 链接（对方 App 拿不到鉴权、也不是「文件分享」体验）。
 *
 * @param mime  资源 MIME（拿不到会从扩展名推断，兜底 application/octet-stream）
 */
suspend fun shareFile(context: Context, url: String?, filename: String?, mime: String? = null) {
    if (url.isNullOrBlank()) return
    val result = withContext(Dispatchers.IO) {
        runCatching {
            val dir = java.io.File(context.cacheDir, "share").apply { mkdirs() }
            // 按文件名落盘并清洗非法字符
            val name = downloadName(filename, Uri.parse(url))
            val file = java.io.File(dir, name)

            val ext = name.substringAfterLast('.', "").lowercase()
            val resolvedMime = mime
                ?: (if (ext.isNotBlank()) MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) else null)
                ?: "application/octet-stream"

            if (resolvedMime.startsWith("image/")) {
                // 图片：走 Coil 复用应用鉴权/缓存栈拿原图
                val request = ImageRequest.Builder(context)
                    .data(url).allowHardware(false).build()
                val res = context.imageLoader.execute(request)
                if (res !is SuccessResult) throw IllegalStateException("图片加载失败")
                val bitmap = (res.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap
                    ?: throw IllegalStateException("无法获取图片数据")
                val isPng = resolvedMime == "image/png" || ext == "png"
                java.io.FileOutputStream(file).use { out ->
                    bitmap.compress(
                        if (isPng) android.graphics.Bitmap.CompressFormat.PNG else android.graphics.Bitmap.CompressFormat.JPEG,
                        95, out,
                    )
                }
            } else {
                // 视频/文件/文档：OkHttp 流式下载（url 已带鉴权 token）
                val client = okhttp3.OkHttpClient()
                val req = okhttp3.Request.Builder().url(url).build()
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) throw IllegalStateException("下载失败 HTTP ${resp.code}")
                    val body = resp.body ?: throw IllegalStateException("空响应")
                    file.outputStream().use { out -> body.byteStream().copyTo(out) }
                }
            }

            val uri = androidx.core.content.FileProvider.getUriForFile(
                context, "${context.packageName}.fileprovider", file,
            )
            Pair(uri, resolvedMime)
        }
    }
    result.onSuccess { (uri, resolvedMime) ->
        withContext(Dispatchers.Main) {
            runCatching {
                val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = resolvedMime
                    putExtra(android.content.Intent.EXTRA_STREAM, uri)
                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = android.content.Intent.createChooser(send, "分享到")
                    .apply { addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK) }
                context.startActivity(chooser)
            }.onFailure {
                Toast.makeText(context, "分享失败：${it.message ?: "未知错误"}", Toast.LENGTH_SHORT).show()
            }
        }
    }.onFailure {
        withContext(Dispatchers.Main) {
            Toast.makeText(context, "分享失败：${it.message ?: "未知错误"}", Toast.LENGTH_SHORT).show()
        }
    }
}

/** 分享纯文本到第三方软件。 */
fun shareText(context: Context, text: String?) {
    if (text.isNullOrBlank()) return
    runCatching {
        val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(android.content.Intent.EXTRA_TEXT, text)
        }
        context.startActivity(
            android.content.Intent.createChooser(send, "分享到")
                .apply { addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK) },
        )
    }.onFailure {
        Toast.makeText(context, "分享失败：${it.message ?: "未知错误"}", Toast.LENGTH_SHORT).show()
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

/**
 * 将文本内容保存到系统 Downloads 目录（Android Q+ 用 MediaStore；Q 以下写 getExternalFilesDir）。
 * 无需 WRITE_EXTERNAL_STORAGE 权限。返回保存的文件名或路径（供 Toast 提示用户）。
 * 供聊天记录导出使用。
 */
suspend fun saveTextToDownloads(context: Context, filename: String, content: String): String =
    withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10+：MediaStore.Downloads，scoped storage，无需写权限
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, filename)
                put(MediaStore.Downloads.MIME_TYPE, "text/plain")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("无法在 Downloads 创建文件")
            resolver.openOutputStream(uri)?.use { out ->
                out.write(content.toByteArray(Charsets.UTF_8))
            } ?: throw IllegalStateException("无法写入文件")
            filename
        } else {
            // Android 9-：写到 app 专属外部文件目录（不需要权限）
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.cacheDir
            dir.mkdirs()
            val file = java.io.File(dir, filename)
            file.writeText(content, Charsets.UTF_8)
            file.absolutePath
        }
    }
