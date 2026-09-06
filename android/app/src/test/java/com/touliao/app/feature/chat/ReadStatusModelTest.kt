package com.touliao.app.feature.chat

import com.touliao.app.data.model.GroupMember
import com.touliao.app.data.model.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 已读状态详情纯函数 —— 对齐 Web utils/readStatus.js 语义
 * （canViewReadStatus 门控 + createReadStatusModel 私聊/群聊两种展示模型）。
 */
class ReadStatusModelTest {

    private fun msg(
        senderId: String = "me",
        type: String = "text",
        deleted: Int = 0,
        localStatus: String? = null,
        id: String = "m1",
    ) = Message(
        id = id, conversation_id = "c1", sender_id = senderId, type = type,
        deleted = deleted, localStatus = localStatus,
    )

    // ── canViewReadStatus ──────────────────────────────────────

    @Test
    fun allowsOwnDeliveredTextImageFileMessages() {
        assertTrue(canViewReadStatus(msg(), "me"))
        assertTrue(canViewReadStatus(msg(type = "image"), "me"))
        assertTrue(canViewReadStatus(msg(type = "file"), "me"))
    }

    @Test
    fun rejectsOthersMessagesAndUnsupportedTypes() {
        assertFalse(canViewReadStatus(msg(senderId = "other"), "me"))
        assertFalse(canViewReadStatus(msg(type = "voice"), "me"))
        assertFalse(canViewReadStatus(msg(type = "video"), "me"))
        assertFalse(canViewReadStatus(msg(type = "red_packet"), "me"))
    }

    @Test
    fun rejectsDeletedSendingAndLocalOnlyMessages() {
        assertFalse(canViewReadStatus(msg(deleted = 1), "me"))
        assertFalse(canViewReadStatus(msg(localStatus = "sending"), "me"))
        assertFalse(canViewReadStatus(msg(localStatus = "failed"), "me"))
        assertFalse(canViewReadStatus(msg(id = ""), "me"))
    }

    // ── 私聊模型 ───────────────────────────────────────────────

    @Test
    fun privateModelMarksReadWhenPeerIdInReadList() {
        val model = buildReadStatusModel(
            isGroup = false, members = emptyList(), currentUserId = "me", senderId = "me",
            readUserIds = listOf("peer"), peerId = "peer", peerName = "张三",
        )
        assertTrue(model.peerRead)
        assertEquals("张三", model.peerName)
    }

    @Test
    fun privateModelMarksUnreadWhenPeerIdMissing() {
        val model = buildReadStatusModel(
            isGroup = false, members = emptyList(), currentUserId = "me", senderId = "me",
            readUserIds = listOf("peer"), peerId = "",
        )
        // 拿不到 peerId 时退化为「有任何人已读」判定（与 Web 同口径）
        assertTrue(model.peerRead)
        val empty = buildReadStatusModel(
            isGroup = false, members = emptyList(), currentUserId = "me", senderId = "me",
            readUserIds = emptyList(), peerId = "",
        )
        assertFalse(empty.peerRead)
    }

    // ── 群聊模型 ───────────────────────────────────────────────

    @Test
    fun groupModelCountsReadersAndRecipientsExcludingSender() {
        val members = listOf(
            GroupMember(id = "me", username = "我"),
            GroupMember(id = "u1", username = "张三"),
            GroupMember(id = "u2", username = "李四"),
            GroupMember(id = "u3", username = "王五"),
        )
        val model = buildReadStatusModel(
            isGroup = true, members = members, currentUserId = "me", senderId = "me",
            readUserIds = listOf("u1", "u2"),
        )
        assertTrue(model.isGroup)
        assertEquals(2, model.readCount)
        assertEquals(3, model.recipientCount)   // 除发送者外 3 人
        assertEquals(listOf("张三", "李四"), model.readers.map { it.name })
    }

    @Test
    fun groupModelDedupesAndDropsEmptyIdsAndSenderEcho() {
        val members = listOf(GroupMember(id = "u1", username = "张三"))
        val model = buildReadStatusModel(
            isGroup = true, members = members, currentUserId = "me", senderId = "me",
            readUserIds = listOf("u1", "u1", "", "  ", "me"),
        )
        assertEquals(1, model.readCount)
        assertEquals(listOf("张三"), model.readers.map { it.name })
    }

    @Test
    fun groupModelPrefersMemberNicknameAndFallsBackToPlaceholder() {
        val members = listOf(
            GroupMember(id = "u1", username = "张三", nickname = "三哥"),
            GroupMember(id = "u2", username = "李四"),
        )
        val model = buildReadStatusModel(
            isGroup = true, members = members, currentUserId = "me", senderId = "me",
            readUserIds = listOf("u1", "unknown-user"),
        )
        assertEquals("三哥", model.readers[0].name)
        // 不在成员表里的已读者（如群成员表滞后）显示空名，由 UI 兜底「群成员」
        assertEquals("", model.readers[1].name)
    }

    @Test
    fun groupModelWithNoReadersShowsZero() {
        val members = listOf(GroupMember(id = "u1", username = "张三"))
        val model = buildReadStatusModel(
            isGroup = true, members = members, currentUserId = "me", senderId = "me",
            readUserIds = emptyList(),
        )
        assertEquals(0, model.readCount)
        assertEquals(1, model.recipientCount)
        assertTrue(model.readers.isEmpty())
    }
}
