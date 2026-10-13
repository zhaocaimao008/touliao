package com.touliao.app.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** BUBBLE-1：气泡单击分发表必须与原先各类型内层 clickable 的行为一一对应。 */
class BubbleTapTest {
    @Test
    fun mediaTypesKeepTheirOriginalTapAction() {
        // 原：图片 clickable{onImageClick}；语音 MediaCard(onPlayVoice)；文件/视频 MediaCard(onOpenFile)；聊天记录 clickable{onOpenMerged}
        assertEquals(BubbleTap.IMAGE, bubbleTapOf("image"))
        assertEquals(BubbleTap.VOICE, bubbleTapOf("voice"))
        assertEquals(BubbleTap.FILE, bubbleTapOf("file"))
        assertEquals(BubbleTap.VIDEO, bubbleTapOf("video"))
        assertEquals(BubbleTap.MERGED, bubbleTapOf("merged"))
    }

    @Test
    fun textContactCardAndUnknownTypesHaveNoTapAction() {
        // 原：文本只有外层 onClick = {}；名片 MediaCard(onClick = {})；其它类型走文本气泡
        for (type in listOf("text", "contact_card", "contact", "", "unknown")) {
            assertNull("type=$type", bubbleTapOf(type))
        }
    }

    @Test
    fun screenReaderLabelsAreReadableChinese() {
        for (tap in BubbleTap.values()) {
            assertTrue("${tap.name} 缺少朗读文字", tap.label.isNotBlank())
        }
        assertEquals(BubbleTap.values().size, BubbleTap.values().map { it.label }.toSet().size)
        assertTrue(BUBBLE_LONG_CLICK_LABEL.isNotBlank())
    }
}
