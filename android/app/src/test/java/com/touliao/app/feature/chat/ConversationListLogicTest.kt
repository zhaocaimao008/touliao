package com.touliao.app.feature.chat

import com.touliao.app.data.model.Conversation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 会话列表本地状态计算：新消息重排（置顶永远在前）、双向清空后的预览、清空菜单文案。
 */
class ConversationListLogicTest {

    private fun conv(id: String, pinned: Int = 0, archived: Int = 0, type: String = "private", name: String = id) =
        Conversation(id = id, type = type, name = name, pinned = pinned, archived = archived)

    private fun ids(list: List<Conversation>) = list.map { it.id }

    @Test
    fun unpinnedIncomingStaysBehindPinned() {
        // 置顶 A，普通 B、C；C 来消息 → A、C、B
        val list = listOf(conv("A", pinned = 1), conv("B"), conv("C"))
        val updated = list[2].copy(lastMessage = "hi")
        assertEquals(listOf("A", "C", "B"), ids(reorderAfterIncoming(list, updated)))
    }

    @Test
    fun unpinnedIncomingStaysBehindAllPinned() {
        val list = listOf(conv("P1", pinned = 1), conv("P2", pinned = 1), conv("B"), conv("C"), conv("D"))
        val updated = list[4].copy(lastMessage = "hi")
        assertEquals(listOf("P1", "P2", "D", "B", "C"), ids(reorderAfterIncoming(list, updated)))
    }

    @Test
    fun pinnedIncomingMovesToTop() {
        val list = listOf(conv("P1", pinned = 1), conv("P2", pinned = 1), conv("B"))
        val updated = list[1].copy(lastMessage = "hi")
        assertEquals(listOf("P2", "P1", "B"), ids(reorderAfterIncoming(list, updated)))
    }

    @Test
    fun withoutPinnedIncomingMovesToTop() {
        val list = listOf(conv("A"), conv("B"), conv("C"))
        val updated = list[2].copy(lastMessage = "hi")
        assertEquals(listOf("C", "A", "B"), ids(reorderAfterIncoming(list, updated)))
    }

    @Test
    fun allPinnedExceptIncomingAppendsAfterPinned() {
        // 只有自己是非置顶：移除后剩下全是置顶 → 排到末尾（置顶之后）
        val list = listOf(conv("B"), conv("P1", pinned = 1), conv("P2", pinned = 1))
        val updated = list[0].copy(lastMessage = "hi")
        assertEquals(listOf("P1", "P2", "B"), ids(reorderAfterIncoming(list, updated)))
    }

    @Test
    fun archivedIncomingKeepsPosition() {
        val list = listOf(conv("P", pinned = 1), conv("B"), conv("X", archived = 1), conv("C"))
        val updated = list[2].copy(lastMessage = "hi", unreadCount = 1)
        val result = reorderAfterIncoming(list, updated)
        assertEquals(listOf("P", "B", "X", "C"), ids(result))
        assertEquals("hi", result[2].lastMessage)
        assertEquals(1, result[2].archived)
    }

    @Test
    fun activeViewKeepsPinnedFirstWithArchivedInterleaved() {
        // 全量列表里夹着归档会话：主列表（过滤后）依然是置顶在前
        val list = listOf(conv("P", pinned = 1), conv("X", archived = 1), conv("B"), conv("C"))
        val updated = list[3].copy(lastMessage = "hi")
        val active = activeConversations(reorderAfterIncoming(list, updated))
        assertEquals(listOf("P", "C", "B"), ids(active))
    }

    @Test
    fun incomingForUnknownConversationReturnsSameList() {
        val list = listOf(conv("A"), conv("B"))
        assertSame(list, reorderAfterIncoming(list, conv("Z")))
    }

    @Test
    fun incomingReplacesOldItemWithoutDuplicates() {
        val list = listOf(conv("P", pinned = 1), conv("B"), conv("C"))
        val result = reorderAfterIncoming(list, list[2].copy(lastMessage = "new"))
        assertEquals(3, result.size)
        assertEquals("new", result.first { it.id == "C" }.lastMessage)
    }

    @Test
    fun clearPreviewOnlyTouchesTargetConversation() {
        val list = listOf(
            conv("A").copy(lastMessage = "a", lastMessageType = "text", lastSenderName = "s", unreadCount = 3, hasMention = true, lastTime = 100),
            conv("B").copy(lastMessage = "b", lastMessageType = "image", unreadCount = 2),
        )
        val result = clearConversationPreview(list, "A")
        val a = result[0]
        assertNull(a.lastMessage)
        assertNull(a.lastMessageType)
        assertNull(a.lastSenderName)
        assertEquals(0, a.unreadCount)
        assertEquals(false, a.hasMention)
        assertEquals(100L, a.lastTime)   // 时间和位置不动
        assertEquals(list[1], result[1])
        assertEquals(listOf("A", "B"), ids(result))
    }

    @Test
    fun clearPreviewUnknownConversationIsNoop() {
        val list = listOf(conv("A").copy(lastMessage = "a"))
        assertEquals(list, clearConversationPreview(list, "Z"))
    }

    @Test
    fun clearMenuHiddenForGroupAndExplicitForPrivate() {
        assertNull(clearMenuLabel("group"))
        assertEquals("双向清空聊天记录", clearMenuLabel("private"))
        assertEquals("清空聊天记录", clearMenuLabel("filehelper"))
    }

    @Test
    fun clearConfirmTextWarnsPeerLosesHistory() {
        val text = clearConfirmText(conv("A", name = "张三"))
        assertEquals("确认双向删除「张三」的全部聊天记录？对方也将看不到这些记录。", text)
        assertTrue(clearConfirmText(conv("A", name = "")).contains("「当前聊天」"))
        assertTrue(clearConfirmText(conv("F", type = "filehelper", name = "文件传输助手")).contains("不可恢复"))
    }
}
