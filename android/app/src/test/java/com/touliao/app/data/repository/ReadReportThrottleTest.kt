package com.touliao.app.data.repository

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 已读上报节流（2026-10-12，后端调用量第一的路由）。 */
class ReadReportThrottleTest {
    private fun m(id: String, seq: Long, at: Long = seq) = ReadMark(id, seq, at)

    @Test fun burstOfMessagesCoalescesIntoOneSendOfTheNewest() {
        val t = ReadReportThrottle()
        assertTrue(t.submit("c1", m("a", 1)))      // 首次：需要安排定时器
        assertFalse(t.submit("c1", m("b", 2)))     // 定时器已在：只更新待发位置
        assertFalse(t.submit("c1", m("c", 3)))
        assertEquals(m("c", 3), t.take("c1", foreground = true))
        assertNull(t.take("c1", foreground = true))
    }

    @Test fun sameOrOlderPositionIsNeverResent() {
        val t = ReadReportThrottle()
        t.submit("c1", m("c", 3)); t.take("c1", true)
        assertFalse(t.submit("c1", m("c", 3)))     // 同一条（滚回底部 / 退出会话重复触发）
        assertFalse(t.submit("c1", m("b", 2)))     // 更旧
        assertTrue(t.submit("c1", m("d", 4)))
    }

    @Test fun conversationsAreIndependent() {
        val t = ReadReportThrottle()
        assertTrue(t.submit("c1", m("a", 5)))
        assertTrue(t.submit("c2", m("x", 1)))
        assertEquals(m("x", 1), t.take("c2", true))
        assertEquals(m("a", 5), t.take("c1", true))
    }

    @Test fun backgroundKeepsPendingUntilForeground() {
        val t = ReadReportThrottle()
        t.submit("c1", m("a", 1))
        assertNull(t.take("c1", foreground = false))   // 后台不发
        assertEquals(listOf("c1"), t.pendingUnscheduled())   // 回前台：重新安排
        assertEquals(emptyList<String>(), t.pendingUnscheduled())   // 已安排，不重复
        assertEquals(m("a", 1), t.take("c1", foreground = true))
    }

    @Test fun failureAllowsRetryOfSamePosition() {
        val t = ReadReportThrottle()
        t.submit("c1", m("a", 1))
        val sent = t.take("c1", true)!!
        t.onFailed("c1", sent)
        assertTrue(t.submit("c1", m("a", 1)))
    }

    @Test fun reopeningConversationReportsAgainOnce() {
        val t = ReadReportThrottle()
        t.submit("c1", m("a", 1)); t.take("c1", true)
        t.reset("c1")                              // 进入会话（期间可能被「标为未读」）
        assertTrue(t.submit("c1", m("a", 1)))
        t.take("c1", true)
        assertFalse(t.submit("c1", m("a", 1)))
    }

    @Test fun fallsBackToCreatedAtWhenSequenceMissing() {
        assertTrue(ReadMark("b", 0, 200).isNewerThan(ReadMark("a", 0, 100)))
        assertFalse(ReadMark("a", 0, 100).isNewerThan(ReadMark("b", 0, 200)))
        assertTrue(ReadMark("b", 0, 100).isNewerThan(ReadMark("a", 0, 100)))   // 同秒不同条：宁多报一次
        assertFalse(ReadMark("a", 9, 100).isNewerThan(ReadMark("a", 9, 100)))
    }
}
