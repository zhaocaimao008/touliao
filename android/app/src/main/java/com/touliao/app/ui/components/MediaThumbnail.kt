package com.touliao.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.touliao.app.core.util.thumbUrlOf
import com.touliao.app.ui.IconColor
import com.touliao.app.ui.IconSize
import com.touliao.app.ui.TouliaoGlyph
import com.touliao.app.ui.TouliaoIcons

/*
 * 媒体缩略图公共组件：聊天文件页宫格、朋友圈九宫格/单图共用。
 * - 只加载服务端缩略图 <uuid>_thumb.webp（命名约定见 core/util/MediaUrlResolver.kt thumbUrlOf；
 *   视频封面由 backend-v2 utils/videoProcess.js generateVideoPoster 按同一约定生成）。
 * - 全屏查看仍由调用方使用原图，这里不管。
 * - 宫格/长列表一律关闭 crossfade（全局 ImageLoader 默认开启）：快速滑动时省掉每张图 200ms 渐变
 *   和额外绘制层，缓存命中时直接显示。
 * - rawUrl 一律传服务端原始值（/uploads/... 相对路径），不要先 resolve：thumbUrlOf 只认相对路径。
 */

// 视频占位固定深色渐变（与朋友圈视频封面占位 0xFF1A1A1A 同一深度），白色播放图标在浅色/深色主题下都清晰
private val VideoPlaceholderTop = Color(0xFF3A3A3C)
private val VideoPlaceholderBottom = Color(0xFF1A1A1A)
// 播放图标的圆形半透明底：封面是亮色画面时白色图标仍可辨认
private val VideoPlayBackdrop = Color(0x66000000)
// 服务端缩略图长边上限的较小值（朋友圈/头像 400px，聊天图片 480px，见 backend-v2 utils/upload.js
// makeExifStripMiddleware）。缩略图长边达到它才说明原图被服务端缩小过；不到说明原图本来就小。
private const val ServerThumbMinCapPx = 400f

/**
 * 图片缩略图：先加载服务端缩略图，失败（缩略图功能上线前的旧图没有缩略图会 404）再回退原图，
 * 与聊天气泡（ChatScreen MessageContent "image"）的回退写法一致。
 * 加载中/失败的占位底色由调用方通过 modifier.background 提供。
 *
 * @param scaleToBounds 单图模式：缩略图加载成功后按宽高比撑满调用方 widthIn/heightIn 给出的最大尺寸。
 *   缩略图长边只有 400~480px，按 Coil 默认（不放大）会比原图显示得更小；宫格这类固定尺寸的格子不需要。
 *   低密度屏上 Coil 已把缩略图缩到格子尺寸、或原图本来就小于缩略图上限时不处理，与改动前显示一致。
 */
@Composable
fun ImageThumbnail(
    rawUrl: String?,
    resolveUrl: (String?) -> String?,
    modifier: Modifier = Modifier,
    contentDescription: String? = "图片",
    contentScale: ContentScale = ContentScale.Crop,
    scaleToBounds: Boolean = false,
) {
    val original = resolveUrl(rawUrl)
    val thumb = resolveUrl(thumbUrlOf(rawUrl))
    var thumbFailed by remember(rawUrl) { mutableStateOf(false) }
    var aspect by remember(rawUrl) { mutableStateOf<Float?>(null) }
    val usingThumb = !thumbFailed && thumb != null && thumb != original
    val imageUrl = if (usingThumb) thumb else original
    val context = LocalContext.current
    val ratio = aspect
    AsyncImage(
        model = remember(imageUrl) {
            ImageRequest.Builder(context).data(imageUrl).crossfade(false).build()
        },
        contentDescription = contentDescription,
        modifier = if (scaleToBounds && ratio != null) modifier.aspectRatio(ratio) else modifier,
        onSuccess = { state ->
            // 只对「被服务端缩小过的缩略图」撑满：回退加载的原图、以及原图本来就小（缩略图没缩）的情况，
            // 都保持改动前按固有尺寸显示，不把小图放大到 220dp 变糊。
            if (scaleToBounds && usingThumb) {
                val intrinsic = state.painter.intrinsicSize
                // Size.Unspecified 读 width/height 会抛异常，先排除（无固有尺寸的 Drawable 会给出 Unspecified）
                if (intrinsic != Size.Unspecified &&
                    intrinsic.width.isFinite() && intrinsic.height.isFinite() && intrinsic.width > 0f && intrinsic.height > 0f &&
                    maxOf(intrinsic.width, intrinsic.height) >= ServerThumbMinCapPx
                ) {
                    aspect = intrinsic.width / intrinsic.height
                }
            }
        },
        // 缩略图失败 → 切回原图重新加载；原图也失败则停在调用方的占位底色上
        onError = { if (usingThumb) thumbFailed = true },
        contentScale = contentScale,
    )
}

/**
 * 视频缩略图：只加载服务端生成的封面帧（<uuid>_thumb.webp）。
 * 封面不存在（旧视频 / 服务端 ffmpeg 不可用）或加载失败时，只显示深色渐变底 + 播放图标，
 * 绝不回退把视频文件本身交给 Coil——Coil 未装视频解码器，会把整段视频下载进磁盘缓存后仍显示灰块。
 */
@Composable
fun VideoThumbnail(
    rawUrl: String?,
    resolveUrl: (String?) -> String?,
    modifier: Modifier = Modifier,
    contentDescription: String? = "视频",
) {
    val poster = resolveUrl(videoPosterPathOf(rawUrl))
    var posterFailed by remember(rawUrl) { mutableStateOf(false) }
    val context = LocalContext.current
    Box(
        modifier.background(Brush.verticalGradient(listOf(VideoPlaceholderTop, VideoPlaceholderBottom))),
        contentAlignment = Alignment.Center,
    ) {
        if (poster != null && !posterFailed) {
            AsyncImage(
                model = remember(poster) {
                    ImageRequest.Builder(context).data(poster).crossfade(false).build()
                },
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                onError = { posterFailed = true },
                contentScale = ContentScale.Crop,
            )
        }
        // 播放标识：读屏文案挂在图标上，封面有没有加载出来都能读到「视频」
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(VideoPlayBackdrop),
            contentAlignment = Alignment.Center,
        ) { TouliaoGlyph(TouliaoIcons.Play, color = IconColor.OnDark, size = IconSize.Md, label = contentDescription) }
    }
}

/**
 * 视频封面的相对路径：只有能按约定推导出与原文件不同的 <uuid>_thumb.webp 时才返回，否则 null。
 * thumbUrlOf 在推导不出时会原样返回入参（即视频地址本身），这里必须拦掉，保证永远不会把视频交给图片加载器。
 */
internal fun videoPosterPathOf(rawUrl: String?): String? {
    if (rawUrl.isNullOrBlank()) return null
    val poster = thumbUrlOf(rawUrl) ?: return null
    return if (poster != rawUrl && poster.endsWith("_thumb.webp")) poster else null
}
