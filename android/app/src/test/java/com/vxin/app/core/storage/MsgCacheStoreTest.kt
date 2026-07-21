package com.vxin.app.core.storage

import com.vxin.app.data.model.Message
import com.vxin.app.core.storage.MsgCacheStore.Companion.MAX_PER_CONV
import com.vxin.app.core.storage.MsgCacheStore.Companion.mergeById
import com.vxin.app.core.storage.MsgCacheStore.Companion.normalize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 离线消息历史缓存 —— 语义基线，1:1 对齐 Web web/src/utils/msgCache.test.js。
 * 只测纯逻辑（normalize / mergeById，即 save/load/remove 的语义内核）；
 * SharedPreferences IO 层沿用已上线的 OutboxStore 形态，不重复测。
 */
class MsgCacheStoreTest {

    // 与 Web 测试 M(id) 等价：content=c<id>，created_at=id。
    private fun m(id: Int, createdAt: Long = id.toLong(), content: String = "c$id"): Message =
        Message(id = id.toString(), conversation_id = "c1", sender_id = "u", content = content, created_at = createdAt)

    private fun ids(list: List<Message>): List<Int> = list.map { it.id.toInt() }

    @Test fun `save-load 往返一致（升序）`() {
        val got = normalize(listOf(m(2), m(1), m(3)))
        assertEquals(listOf(1, 2, 3), ids(got))
    }

    @Test fun `超过 50 条只留最近 50（按 created_at）`() {
        val many = (1..70).map { m(it) }
        val got = normalize(many)
        assertEquals(MAX_PER_CONV, got.size)
        assertEquals(21, got.first().id.toInt())          // 最近 50 → id 21..70
        assertEquals(70, got.last().id.toInt())
    }

    @Test fun `按 id 去重（同 id 只留一条，后者覆盖）`() {
        val got = normalize(listOf(m(1), m(1, content = "dup"), m(2)))
        assertEquals(listOf(1, 2), ids(got))
        assertEquals("dup", got.first { it.id == "1" }.content)
    }

    @Test fun `乐观消息（clientMsgId 或 localStatus）不入缓存`() {
        val optimistic = m(2).copy(clientMsgId = "t2")
        val sending = m(3).copy(localStatus = "sending")
        val got = normalize(listOf(m(1), optimistic, sending))
        assertEquals(listOf(1), ids(got))
    }

    @Test fun `无真实 id 的消息不入缓存`() {
        val got = normalize(listOf(m(1), m(2).copy(id = "")))
        assertEquals(listOf(1), ids(got))
    }

    @Test fun `id 作为 created_at 相同时的 tie-break`() {
        val got = normalize(listOf(m(3, createdAt = 5), m(1, createdAt = 5), m(2, createdAt = 5)))
        assertEquals(listOf(1, 2, 3), ids(got))
    }

    @Test fun `mergeById - server 版本覆盖同 id 的旧缓存内容`() {
        val cached = listOf(m(1, content = "旧"), m(2))
        val server = listOf(m(1, content = "新(已编辑)"), m(3))
        val merged = mergeById(cached, server)
        assertEquals(listOf(1, 2, 3), ids(merged))
        assertEquals("新(已编辑)", merged.first { it.id == "1" }.content)
    }

    @Test fun `mergeById - 合并后仍截断最近 50 并去乐观`() {
        val cached = (1..40).map { m(it) }
        val server = (30..69).map { m(it) } + m(999).copy(clientMsgId = "t")
        val merged = mergeById(cached, server)
        assertTrue(merged.size <= MAX_PER_CONV)
        assertTrue(merged.none { it.clientMsgId != null })
        assertTrue(merged.none { it.id == "999" })
    }

    @Test fun `空输入安全返回空`() {
        assertEquals(emptyList<Message>(), normalize(emptyList()))
        assertEquals(emptyList<Message>(), mergeById(emptyList(), emptyList()))
    }
}
