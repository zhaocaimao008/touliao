package com.touliao.app.navigation

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 拒接后「回复消息」带过去的会话提示（contracts C12）：先记提示再写 id、取出即删、不同会话互不影响 */
class PendingConversationHolderTest {

    @After
    fun reset() {
        // 全局单例：清掉本用例留下的状态，避免影响其他用例
        PendingConversationHolder.conversationId.value = null
        PendingConversationHolder.takeHint("c1")
        PendingConversationHolder.takeHint("c2")
    }

    @Test
    fun offerRecordsHintBeforePublishingId() {
        PendingConversationHolder.offer("c1", "李明", "u1")
        assertEquals("c1", PendingConversationHolder.conversationId.value)
        // 收集方看到 id 时提示已就位
        assertEquals("李明" to "u1", PendingConversationHolder.takeHint("c1"))
    }

    @Test
    fun takeHintRemovesIt() {
        PendingConversationHolder.offer("c1", "李明", "u1")
        PendingConversationHolder.takeHint("c1")
        assertNull(PendingConversationHolder.takeHint("c1"))
    }

    @Test
    fun hintsOfDifferentConversationsAreIndependent() {
        PendingConversationHolder.offer("c1", "李明", "u1")
        PendingConversationHolder.offer("c2", "王芳", "u2")
        // 后一次 offer 覆盖待跳转 id，但前一个会话的提示仍在
        assertEquals("c2", PendingConversationHolder.conversationId.value)
        assertEquals("王芳" to "u2", PendingConversationHolder.takeHint("c2"))
        assertEquals("李明" to "u1", PendingConversationHolder.takeHint("c1"))
        // 普通通知点击（没有 offer）查不到提示
        assertNull(PendingConversationHolder.takeHint("c3"))
    }
}
