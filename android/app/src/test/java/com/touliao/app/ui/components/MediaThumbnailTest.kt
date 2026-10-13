package com.touliao.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 视频封面路径推导：只在能推导出 <uuid>_thumb.webp 时返回，其余一律 null，
 * 保证宫格永远不会把视频文件本身交给图片加载器（Coil 未装视频解码器，会整段下载）。
 */
class MediaThumbnailTest {

    @Test
    fun uploadedVideoMapsToServerPoster() {
        assertEquals("/uploads/files/abc-123_thumb.webp", videoPosterPathOf("/uploads/files/abc-123.mp4"))
        assertEquals("/uploads/moments/v1_thumb.webp", videoPosterPathOf("/uploads/moments/v1.MOV"))
    }

    @Test
    fun blankInputHasNoPoster() {
        assertNull(videoPosterPathOf(null))
        assertNull(videoPosterPathOf(""))
        assertNull(videoPosterPathOf("   "))
    }

    @Test
    fun underivablePathsNeverFallBackToTheVideoItself() {
        // 非本站上传路径（如对象存储绝对地址）：thumbUrlOf 原样返回，这里必须拦成 null
        assertNull(videoPosterPathOf("https://cdn.example.com/uploads/files/abc.mp4"))
        // 带查询参数 / 没有扩展名：推导不出缩略图
        assertNull(videoPosterPathOf("/uploads/files/abc.mp4?v=1"))
        assertNull(videoPosterPathOf("/uploads/files/abc"))
        // 已经是缩略图：与入参相同，不视为封面
        assertNull(videoPosterPathOf("/uploads/files/abc_thumb.webp"))
    }
}
