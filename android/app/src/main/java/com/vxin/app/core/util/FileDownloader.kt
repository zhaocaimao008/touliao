package com.vxin.app.core.util

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.webkit.MimeTypeMap
import android.widget.Toast

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
