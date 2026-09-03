package com.touliao.app.feature.chat

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import com.touliao.app.core.util.downloadHttpClient
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.touliao.app.core.util.saveVideoToGallery
import com.touliao.app.core.util.shareFile
import com.touliao.app.ui.theme.VxinTextSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * 全屏视频播放：ExoPlayer + PlayerView，App 内播放不跳系统播放器/浏览器。
 * url 已带 ?token= 鉴权（见 MediaUrlResolver），ExoPlayer 直接用带参数的完整URL即可播放，
 * 不需要额外定制 DataSource 加 Header（后端鉴权本就走查询参数，不是 Header）。
 */
@Composable
fun VideoPlayerOverlay(url: String, filename: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val exoPlayer = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(Unit) {
        onDispose { exoPlayer.release() }
    }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        player = exoPlayer
                        useController = true
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            Text(
                "✕",
                color = Color.White,
                fontSize = VxinTextSize.lg,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(top = 40.dp, start = 16.dp)
                    .background(Color(0x66000000), RoundedCornerShape(50))
                    .clickable { onDismiss() }
                    .padding(10.dp),
            )
            Row(
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 40.dp, end = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "分享", color = Color.White, fontSize = VxinTextSize.base,
                    modifier = Modifier
                        .background(Color(0x66000000), RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.card))
                        .clickable { scope.launch { shareFile(context, url, filename, "video/mp4") } }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
                Text(
                    "保存视频", color = Color.White, fontSize = VxinTextSize.base,
                    modifier = Modifier
                        .background(Color(0x66000000), RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.card))
                        .clickable { scope.launch { saveVideoToGallery(context, url, filename) } }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
    }
}

/**
 * PDF App 内预览：Android 系统自带 android.graphics.pdf.PdfRenderer（API 21+，无需第三方库，
 * 全程离线本地渲染，不经任何网络转换服务）。PdfRenderer 需要本地文件描述符，不能直接对接
 * 网络流，所以先用 OkHttp 把文件流式下载到 cache 目录，再逐页渲染成 Bitmap。
 */
@Composable
fun PdfViewerOverlay(url: String, filename: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var pages by remember { mutableStateOf<List<Bitmap>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(url) {
        withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(context.cacheDir, "pdf_preview").apply { mkdirs() }
                val file = File(dir, "preview_${System.currentTimeMillis()}.pdf")
                val client = downloadHttpClient(context)
                val req = okhttp3.Request.Builder().url(url).build()
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) throw IllegalStateException("HTTP ${resp.code}")
                    val body = resp.body ?: throw IllegalStateException("空响应")
                    file.outputStream().use { out -> body.byteStream().copyTo(out) }
                }
                val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                val renderer = PdfRenderer(pfd)
                val bitmaps = mutableListOf<Bitmap>()
                for (i in 0 until renderer.pageCount) {
                    renderer.openPage(i).use { page ->
                        val bmp = Bitmap.createBitmap(page.width * 2, page.height * 2, Bitmap.Config.ARGB_8888)
                        bmp.eraseColor(android.graphics.Color.WHITE)
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bitmaps.add(bmp)
                    }
                }
                renderer.close()
                pfd.close()
                file.delete()
                bitmaps
            }.onSuccess { bitmaps -> pages = bitmaps }
                .onFailure { error = it.message ?: "PDF 解析失败" }
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xFF525659))) {
            when {
                error != null -> Column(
                    Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("无法预览：$error", color = Color.White)
                }
                pages == null -> CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center), color = Color.White,
                )
                else -> LazyColumn(
                    Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    contentPadding = PaddingValues(vertical = 16.dp),
                ) {
                    items(pages!!) { bmp ->
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = "PDF 页面",
                            modifier = Modifier.padding(bottom = 12.dp).background(Color.White),
                        )
                    }
                }
            }
            Text(
                "✕", color = Color.White, fontSize = VxinTextSize.lg,
                modifier = Modifier.align(Alignment.TopStart).padding(top = 40.dp, start = 16.dp)
                    .background(Color(0x66000000), RoundedCornerShape(50))
                    .clickable { onDismiss() }.padding(10.dp),
            )
            filename?.let {
                Text(
                    it, color = Color.White, fontSize = VxinTextSize.base,
                    maxLines = 1,
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 44.dp).padding(horizontal = 60.dp),
                )
            }
        }
    }
}

/**
 * 不支持 App 内预览的格式（旧版 doc/ppt 二进制、zip/rar 等压缩包、其他二进制）落到这个
 * 「文件详情页」——只显示信息 + 下载/分享/用其他应用打开，绝不自动调用系统。
 * "用其他应用打开"是用户主动选择的动作，点了才会调用系统 Intent 打开本地已下载文件。
 */
@Composable
fun FileDetailsOverlay(url: String, filename: String?, sizeText: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xE6000000))) {
            Column(
                Modifier.align(Alignment.Center).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier.size(64.dp).background(Color(0x33FFFFFF), RoundedCornerShape(12.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("FILE", color = Color.White, fontSize = VxinTextSize.sm2)
                }
                Spacer(Modifier.height(16.dp))
                Text(filename ?: "未知文件", color = Color.White, fontSize = VxinTextSize.base, maxLines = 2)
                if (!sizeText.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(sizeText, color = Color(0xAAFFFFFF), fontSize = VxinTextSize.sm2)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "该文件格式暂不支持在投聊内直接预览，可以下载保存，或下载后选择用其他应用打开。",
                    color = Color(0x99FFFFFF), fontSize = VxinTextSize.sm2,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Spacer(Modifier.height(24.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "下载", color = Color.White, fontSize = VxinTextSize.base,
                        modifier = Modifier
                            .background(Color(0x33FFFFFF), RoundedCornerShape(20.dp))
                            .clickable { com.touliao.app.core.util.downloadFile(context, url, filename) }
                            .padding(horizontal = 20.dp, vertical = 10.dp),
                    )
                    Text(
                        "分享", color = Color.White, fontSize = VxinTextSize.base,
                        modifier = Modifier
                            .background(Color(0x33FFFFFF), RoundedCornerShape(20.dp))
                            .clickable { scope.launch { shareFile(context, url, filename) } }
                            .padding(horizontal = 20.dp, vertical = 10.dp),
                    )
                }
            }
            Text(
                "✕", color = Color.White, fontSize = VxinTextSize.lg,
                modifier = Modifier.align(Alignment.TopStart).padding(top = 40.dp, start = 16.dp)
                    .background(Color(0x66000000), RoundedCornerShape(50))
                    .clickable { onDismiss() }.padding(10.dp),
            )
        }
    }
}
