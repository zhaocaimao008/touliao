package com.touliao.app.feature.chat

import com.touliao.app.data.model.Conversation
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 会话归档本地分流纯函数 —— 对齐 Web utils/archiveConversations.test.js 语义。
 */
class ConversationArchiveTest {

    private fun conv(id: String, archived: Int = 0, unread: Int = 0) =
        Conversation(id = id, name = id, archived = archived, unreadCount = unread)

    @Test
    fun splitSeparatesActiveAndArchivedConversations() {
        val list = listOf(conv("a"), conv("b", archived = 1), conv("c"))
        assertEquals(listOf("a", "c"), activeConversations(list).map { it.id })
        assertEquals(listOf("b"), archivedConversations(list).map { it.id })
    }

    @Test
    fun splitHandlesEmptyList() {
        assertEquals(0, activeConversations(emptyList()).size)
        assertEquals(0, archivedConversations(emptyList()).size)
    }

    @Test
    fun archiveUnreadTotalSumsOnlyArchivedUnread() {
        val list = listOf(
            conv("a", unread = 3),            // 主列表，不计入
            conv("b", archived = 1, unread = 2),
            conv("c", archived = 1, unread = 5),
        )
        assertEquals(7, archiveUnreadTotal(list))
    }

    @Test
    fun archiveUnreadTotalClampsNegativeCounts() {
        val list = listOf(conv("a", archived = 1, unread = -2), conv("b", archived = 1, unread = 4))
        assertEquals(4, archiveUnreadTotal(list))
    }

    @Test
    fun archivedFlagKeptWhenSummaryFieldsChange() {
        // socket 新消息只刷新 summary/unread：copy 后 archived 标记保留 → 不会被移回主列表
        val before = conv("a", archived = 1, unread = 1)
        val after = before.copy(lastMessage = "hi", unreadCount = 2)
        assertEquals(1, after.archived)
        assertEquals(listOf("a"), archivedConversations(listOf(after)).map { it.id })
    }
}
