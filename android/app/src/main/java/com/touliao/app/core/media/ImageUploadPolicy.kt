package com.touliao.app.core.media

/**
 * 上传前图片是否需要在本地转码为 JPEG。
 *
 * 服务端审核（localMediaScanner）用预编译 sharp 解码：不含 HEVC 解码器，HEIC/HEIF 一律
 * 400「图片损坏、尺寸过大或格式无法解析」；且像素上限 4000 万，5000 万/1 亿像素主摄原图同样被拒。
 * Windows/Web 端也无法显示 HEIC。所以这两类图在手机端先转成长边 ≤ [MAX_EDGE] 的 JPEG，
 * 通用格式且尺寸合规的原图不动（保留原画质，EXIF 由服务端剥离）。
 */
object ImageUploadPolicy {
    /** 与 backend-v2 localMediaScanner limitInputPixels 保持一致 */
    const val SERVER_MAX_PIXELS = 40_000_000L
    const val MAX_EDGE = 4096
    const val JPEG_QUALITY = 88

    private val passThroughMimes = setOf("image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif")

    fun needsTranscode(mime: String, width: Int, height: Int): Boolean {
        val m = mime.lowercase().substringBefore(';').trim()
        if (!m.startsWith("image/")) return false
        if (m !in passThroughMimes) return true
        // GIF 动图转 JPEG 会丢帧；超限 GIF 交给服务端提示
        if (m == "image/gif") return false
        return width.toLong() * height.toLong() > SERVER_MAX_PIXELS
    }

    /** 等比缩放到长边不超过 [MAX_EDGE] 的目标尺寸 */
    fun targetSize(width: Int, height: Int): Pair<Int, Int> {
        val longEdge = maxOf(width, height)
        if (longEdge <= MAX_EDGE) return width to height
        val scale = MAX_EDGE.toDouble() / longEdge
        return maxOf(1, (width * scale).toInt()) to maxOf(1, (height * scale).toInt())
    }

    /** BitmapFactory 预缩放：不低于目标尺寸的最大 2 的幂 */
    fun sampleSize(width: Int, height: Int): Int {
        var sample = 1
        while (maxOf(width, height) / (sample * 2) >= MAX_EDGE) sample *= 2
        return sample
    }

    fun jpegName(name: String): String = name.substringBeforeLast('.', name).ifBlank { "image" } + ".jpg"
}
