package com.touliao.app.feature.chat

import com.touliao.app.data.model.ConversationEvent
import com.touliao.app.data.model.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ChatMessageMerge 纯函数红灯用例 —— 对齐 Web messageSync.test.js 语义。
 *
 * 第 1 步（纯抽取）预期：2 绿 2 红
 *   绿1 尾部 pending 保持位置（真实消息序不被破坏）
 *   绿2 乐观占位替换不双显（applySyncEvents 的 removeAll+重插路径结构性安全）
 *   红1 洞 A：中间 pending 使二分中位探测右跳 → 新消息插错位置（真实序乱）
 *   红2 洞 B：claimOrAppend 保留位置替换 → 确认消息带新 seq 停在错槽位（真实序乱）
 */
class ChatMessageMergeTest {

    // ── 构造辅助 ──────────────────────────────────────────────
    private fun msg(
        id: String,
        seq: Long,
        cid: String? = null,
        local: String? = null,
        createdAt: Long = 0,
    ) = Message(
        id = id, conversation_id = "c1", sender_id = "u1", content = id,
        created_at = createdAt, server_sequence = seq,
        clientMsgId = cid, localStatus = local,
    )

    private fun createdEvent(seq: Long, m: Message) = ConversationEvent(
        server_sequence = seq, event_type = "message_created",
        message_id = m.id, message = m,
    )

    /** pending 判定：localStatus 非空 = 本地乐观/失败气泡（seq=0） */
    private fun realMsgs(list: List<Message>) = list.filter { it.localStatus == null }

    /** 核心不变式：过滤 pending 后，真实消息必须严格按 server_sequence 升序 */
    private fun assertRealSeqAscending(list: List<Message>) {
        val seqs = realMsgs(list).map { it.server_sequence }
        assertEquals("真实消息必须按 server_sequence 升序: $seqs", seqs.sorted(), seqs)
    }

    // ── 用例 ──────────────────────────────────────────────────
    @Test
    fun tailPendingKeepsPositionAndRealOrder() {
        val m1 = msg("m1", 1, createdAt = 100)
        val m2 = msg("m2", 2, createdAt = 200)
        val p = msg("p", 0, cid = "C1", local = "failed", createdAt = 300)   // 尾部 pending
        val new3 = msg("new3", 3, createdAt = 400)

        val result = insertBySeq(listOf(m1, m2, p), new3)

        assertEquals(4, result.size)
        assertTrue("pending 不得丢失", result.contains(p))
        assertRealSeqAscending(result)
    }

    @Test
    fun optimisticClaimReplacesWithoutDuplicate() {
        val m1 = msg("m1", 1)
        val p = msg("p", 0, cid = "C1", local = "sending")
        val real = msg("r1", 2, cid = "C1")   // 服务端回执：同 client_msg_id、真实 id/seq

        val result = applySyncEvents(listOf(m1, p), listOf(createdEvent(2, real)))

        assertEquals(2, result.size)
        assertTrue("乐观占位已让位", result.none { it.id == "p" })
        assertEquals("真实消息不得双显", 1, result.count { it.id == "r1" })
        assertRealSeqAscending(result)
    }

    /** 洞 A：中间 pending（created_at 混排产物）使二分中位探测右跳，新消息插到错误位置 */
    @Test
    fun midPendingBreaksBinaryInsert() {
        // tmp(seq0) 卡在 m2 与 m3 之间（mergeServerWithPending 按 created_at 混排的典型结果）
        val m1 = msg("m1", 1)
        val m2 = msg("m2", 3)
        val p = msg("p", 0, cid = "C1", local = "failed")
        val m3 = msg("m3", 4)
        val new2 = msg("new2", 2)   // 真实槽位在 m1 与 m2 之间

        val result = insertBySeq(listOf(m1, m2, p, m3), new2)

        // 红（现状）：二分 mid 先探到 p(0<2) → lo 右跳 → new2 插到 m2 后 → 真实序 [1,3,2,4]
        assertRealSeqAscending(result)
    }

    /** 洞 B：广播回声保留位置替换（claimOrAppend），确认消息带新 seq 停在错槽位 */
    @Test
    fun echoReplacesPendingInPlaceWithoutRelocation() {
        // m2(seq3) 为对端消息先显示；本地失败消息 p 停尾部；服务端其实先落库了 p 的确认
        // （seq2，应插 m1 与 m2 之间），echo 到达时按 client_msg_id 认领替换但保留尾部位置。
        val m1 = msg("m1", 1)
        val m2 = msg("m2", 3)
        val p = msg("p", 0, cid = "C1", local = "failed")
        val echo = msg("r2", 2, cid = "C1")   // 服务端确认回声：真实 seq=2

        val result = claimOrAppend(listOf(m1, m2, p), echo)

        // 红（现状）：替换后 [m1(1), m2(3), r2(2)] —— 真实序 [1,3,2] 永续乱序（catchUp 同 id 就地更新也不修）
        assertRealSeqAscending(result)
    }
}
