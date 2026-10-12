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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt
import java.io.File

/**
 * 全屏视频播放：ExoPlayer + PlayerView，App 内播放不跳系统播放器/浏览器。
 * 播放器使用短期只读票据（见 MediaUrlResolver），ExoPlayer 直接用带参数的完整URL即可播放，
 * 不需要额外定制 DataSource 加 Header（后端鉴权本就走查询参数，不是 Header）。
 */
@Composable
fun VideoPlayerOverlay(url: String, filename: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val exoPlayer = remember {
        ExoPlayer.Builder(context).build()
    }
    LaunchedEffect(url) {
        try {
            val ticket = com.touliao.app.core.util.mediaResolver(context).ticket(url)
            exoPlayer.setMediaItem(MediaItem.fromUri(ticket))
            exoPlayer.prepare()
            exoPlayer.playWhenReady = true
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (_: Exception) { android.widget.Toast.makeText(context, "视频授权失败，请重试", android.widget.Toast.LENGTH_SHORT).show() }
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
            com.touliao.app.ui.TouliaoGlyph(
                com.touliao.app.ui.TouliaoIcons.Close, label = "关闭预览", color = com.touliao.app.ui.IconColor.OnDark, size = com.touliao.app.ui.IconSize.Md,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(top = 40.dp, start = 16.dp)
                    .background(Color(0x66000000), RoundedCornerShape(50))
                    .clickable { onDismiss() }
                    .padding(12.dp),
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
 * 网络流，所以先用 OkHttp 把文件流式下载到 cache 目录；页面按需懒渲染（仅渲染滚到可见区的页，
 * 宽度按屏宽缩放并封顶），离开组合即释放位图，避免大 PDF 一次性渲染全部页面导致 OOM。
 */
@Composable
fun PdfViewerOverlay(url: String, filename: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var doc by remember { mutableStateOf<PdfDoc?>(null) }
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
                PdfDoc.open(file)
            }.onSuccess { opened -> doc = opened }
                .onFailure { error = it.message ?: "PDF 解析失败" }
        }
    }
    // 关闭预览时释放 PdfRenderer、文件描述符与临时文件（等待正在进行的页渲染结束）
    DisposableEffect(doc) {
        val opened = doc
        onDispose { opened?.closeAsync() }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xFF525659))) {
            val opened = doc
            when {
                error != null -> Column(
                    Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("无法预览：$error", color = Color.White)
                }
                opened == null -> CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center), color = Color.White,
                )
                else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                    // 按屏宽渲染（封顶，防止平板/横屏下单页位图过大）
                    val targetWidthPx = constraints.maxWidth.coerceIn(1, PDF_MAX_RENDER_WIDTH_PX)
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        contentPadding = PaddingValues(vertical = 16.dp),
                    ) {
                        items(opened.pageCount) { index ->
                            PdfPageItem(opened, index, targetWidthPx)
                        }
                    }
                }
            }
            com.touliao.app.ui.TouliaoGlyph(
                com.touliao.app.ui.TouliaoIcons.Close, label = "关闭预览", color = com.touliao.app.ui.IconColor.OnDark, size = com.touliao.app.ui.IconSize.Md,
                modifier = Modifier.align(Alignment.TopStart).padding(top = 40.dp, start = 16.dp)
                    .background(Color(0x66000000), RoundedCornerShape(50))
                    .clickable { onDismiss() }.padding(12.dp),
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

/** 单页渲染宽度上限（px）：ARGB_8888 下 1440×~2000 一页约 11MB，可见区通常只有 1~3 页 */
private const val PDF_MAX_RENDER_WIDTH_PX = 1440

/** 单页：进入组合时在 IO 线程按需渲染，离开组合即放弃引用（位图交由 GC 回收） */
@Composable
private fun PdfPageItem(doc: PdfDoc, index: Int, targetWidthPx: Int) {
    val aspect = doc.aspectRatio(index)
    val bitmap by produceState<Bitmap?>(initialValue = null, doc, index, targetWidthPx) {
        value = withContext(Dispatchers.IO) { runCatching { doc.render(index, targetWidthPx) }.getOrNull() }
    }
    Box(
        Modifier.padding(bottom = 12.dp).fillMaxWidth().aspectRatio(aspect).background(Color.White),
        contentAlignment = Alignment.Center,
    ) {
        val bmp = bitmap
        if (bmp != null) {
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = "PDF 第 ${index + 1} 页",
                contentScale = androidx.compose.ui.layout.ContentScale.FillWidth,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp, color = Color(0xFF525659))
        }
    }
}

/**
 * 已打开的 PDF。PdfRenderer 同一时刻只允许打开一页，所有 openPage / close 都经 [mutex] 串行化。
 * 打开时预读各页宽高比用于占位，滚动时不跳动。
 */
private class PdfDoc private constructor(
    private val file: File,
    private val pfd: ParcelFileDescriptor,
    private val renderer: PdfRenderer,
    private val aspects: FloatArray,
) {
    private val mutex = Mutex()
    private var closed = false
    val pageCount: Int get() = aspects.size

    fun aspectRatio(index: Int): Float = aspects.getOrElse(index) { 1f / 1.414f }

    /** 按目标宽度渲染一页；已关闭返回 null。PdfRenderer 要求 ARGB_8888。 */
    suspend fun render(index: Int, targetWidthPx: Int): Bitmap? = mutex.withLock {
        if (closed) return@withLock null
        renderer.openPage(index).use { page ->
            val w = targetWidthPx.coerceAtLeast(1)
            val h = (w.toFloat() * page.height / page.width.coerceAtLeast(1)).roundToInt().coerceAtLeast(1)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.eraseColor(android.graphics.Color.WHITE)
            // transform 传 null：页面内容缩放铺满整张位图
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            bmp
        }
    }

    /** 异步关闭（等正在进行的渲染完成后再关 renderer / fd，并删除临时文件） */
    fun closeAsync() {
        CoroutineScope(Dispatchers.IO).launch {
            mutex.withLock {
                if (closed) return@withLock
                closed = true
                runCatching { renderer.close() }
                runCatching { pfd.close() }
                runCatching { file.delete() }
            }
        }
    }

    companion object {
        fun open(file: File): PdfDoc {
            val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            try {
                val renderer = PdfRenderer(pfd)
                try {
                    val aspects = FloatArray(renderer.pageCount) { i ->
                        renderer.openPage(i).use { page -> page.width.toFloat() / page.height.coerceAtLeast(1) }
                    }
                    return PdfDoc(file, pfd, renderer, aspects)
                } catch (e: Throwable) {
                    runCatching { renderer.close() }; throw e
                }
            } catch (e: Throwable) {
                runCatching { pfd.close() }; file.delete(); throw e
            }
        }
    }
}

/**
 * 不支持 App 内预览的格式（旧版 doc/ppt 二进制、zip/rar 等压缩包、其他二进制）落到这个
 * 「文件详情页」——只显示信息 + 下载/分享，打开详情页本身绝不自动调用系统。
 * 用户主动点"下载"后，下载完成会用系统 Intent 打开本地已下载文件（见 downloadFile）。
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
                    com.touliao.app.ui.TouliaoGlyph(com.touliao.app.ui.TouliaoIcons.FileContent, color = com.touliao.app.ui.IconColor.OnDark, size = com.touliao.app.ui.IconSize.Xl)
                }
                Spacer(Modifier.height(16.dp))
                Text(filename ?: "未知文件", color = Color.White, fontSize = VxinTextSize.base, maxLines = 2)
                if (!sizeText.isNullOrBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(sizeText, color = Color(0xAAFFFFFF), fontSize = VxinTextSize.sm2)
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "该文件格式暂不支持在投聊内直接预览，下载完成后将自动用其他应用打开。",
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
            com.touliao.app.ui.TouliaoGlyph(
                com.touliao.app.ui.TouliaoIcons.Close, label = "关闭预览", color = com.touliao.app.ui.IconColor.OnDark, size = com.touliao.app.ui.IconSize.Md,
                modifier = Modifier.align(Alignment.TopStart).padding(top = 40.dp, start = 16.dp)
                    .background(Color(0x66000000), RoundedCornerShape(50))
                    .clickable { onDismiss() }.padding(12.dp),
            )
        }
    }
}
