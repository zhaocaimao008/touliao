package com.touliao.app.feature.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

/**
 * 全局搜索分类筛选纯函数 —— 对齐 Web utils/messageSearchFilters.test.js 语义
 * （参数构造：无筛选不带多余参数；时间区间从当天 0 点起算；摘要不泄结构化 JSON）。
 */
class SearchFiltersTest {

    // ── buildSearchFilterParams ────────────────────────────────

    @Test
    fun noFiltersProducesEmptyParams() {
        val params = buildSearchFilterParams(type = "", timeRange = "", senderId = "")
        assertTrue(params.isEmpty)
        assertNull(params.type)
        assertNull(params.fromSec)
        assertNull(params.toSec)
        assertNull(params.senderId)
    }

    @Test
    fun typeOnlySetsTypeWithoutTimeRange() {
        val params = buildSearchFilterParams(type = "image", timeRange = "", senderId = "")
        assertEquals("image", params.type)
        assertNull(params.fromSec)
        assertNull(params.toSec)
        assertFalse(params.isEmpty)
    }

    @Test
    fun blankTypeAndSenderAreNormalizedToNull() {
        val params = buildSearchFilterParams(type = " ", timeRange = "", senderId = " ")
        assertNull(params.type)
        assertNull(params.senderId)
    }

    private fun startOfDayMillis(nowMillis: Long): Long {
        val cal = Calendar.getInstance().apply { timeInMillis = nowMillis }
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }

    @Test
    fun todayRangeStartsAtMidnight() {
        val now = 1757000000000L   // 固定时刻（2026-09-04 前后，具体时区不影响断言口径）
        val params = buildSearchFilterParams(type = "", timeRange = "today", senderId = "", nowMillis = now)
        assertEquals(startOfDayMillis(now) / 1000, params.fromSec)
        assertEquals(now / 1000, params.toSec)
    }

    @Test
    fun sevenDayRangeGoesBackSevenDaysFromMidnight() {
        val now = 1757000000000L
        val params = buildSearchFilterParams(type = "", timeRange = "7d", senderId = "", nowMillis = now)
        assertEquals((startOfDayMillis(now) - 7L * 24 * 3600 * 1000) / 1000, params.fromSec)
        assertEquals(now / 1000, params.toSec)
    }

    @Test
    fun thirtyDayRangeGoesBackThirtyDaysFromMidnight() {
        val now = 1757000000000L
        val params = buildSearchFilterParams(type = "", timeRange = "30d", senderId = "", nowMillis = now)
        assertEquals((startOfDayMillis(now) - 30L * 24 * 3600 * 1000) / 1000, params.fromSec)
    }

    @Test
    fun combinedFiltersCarryAllParams() {
        val now = 1757000000000L
        val params = buildSearchFilterParams(type = "text,image", timeRange = "7d", senderId = "u1", nowMillis = now)
        assertEquals("text,image", params.type)
        assertEquals("u1", params.senderId)
        assertEquals((startOfDayMillis(now) - 7L * 24 * 3600 * 1000) / 1000, params.fromSec)
        assertEquals(now / 1000, params.toSec)
    }

    // ── messageSearchTypeIcon ──────────────────────────────────

    @Test
    fun typeIconFallsBackForUnknownType() {
        assertEquals("○", messageSearchTypeIcon(""))
        assertEquals("文", messageSearchTypeIcon("text"))
        assertEquals("包", messageSearchTypeIcon("red_packet"))
        assertEquals("•", messageSearchTypeIcon("nope"))
    }

    // ── formatSearchMessageSummary ─────────────────────────────

    @Test
    fun textSummaryReturnsContentAsIs() {
        assertEquals("你好世界", formatSearchMessageSummary("text", "你好世界"))
    }

    @Test
    fun mediaSummaryUsesCompactLabelWithDetail() {
        assertEquals("[图片] photo.jpg", formatSearchMessageSummary("image", "photo.jpg"))
        assertEquals("[文件] doc.pdf", formatSearchMessageSummary("file", "doc.pdf"))
        assertEquals("[视频] clip.mp4", formatSearchMessageSummary("video", "clip.mp4"))
        assertEquals("[语音]", formatSearchMessageSummary("voice", "anything"))
        assertEquals("[文件]", formatSearchMessageSummary("file", "  "))
    }

    @Test
    fun structuredSummaryExtractsHumanFieldsWithoutLeakingJson() {
        assertEquals(
            "[名片] 张三",
            formatSearchMessageSummary("contact_card", """{"id":"x","remark":"张三","phone":"13800000000"}"""),
        )
        assertEquals(
            "[红包] 恭喜发财",
            formatSearchMessageSummary("red_packet", """{"greeting":"恭喜发财","amount":100}"""),
        )
        assertEquals(
            "[转账] 请查收",
            formatSearchMessageSummary("transfer", """{"note":"请查收","amount":5}"""),
        )
        assertEquals(
            "[聊天记录] 张三和李四的聊天记录",
            formatSearchMessageSummary("merged", """{"title":"张三和李四的聊天记录","items":[]}"""),
        )
    }

    @Test
    fun structuredSummaryWithBrokenJsonKeepsLabelOnly() {
        assertEquals("[红包]", formatSearchMessageSummary("red_packet", "{not json"))
        assertEquals("[名片]", formatSearchMessageSummary("contact_card", ""))
    }

    @Test
    fun structuredSummaryPrefersRemarkThenUsernameThenName() {
        assertEquals("[名片] 备注", formatSearchMessageSummary("contact_card", """{"remark":"备注","username":"用户名"}"""))
        assertEquals("[名片] 用户名", formatSearchMessageSummary("contact_card", """{"username":"用户名","name":"名字"}"""))
        assertEquals("[名片] 名字", formatSearchMessageSummary("contact_card", """{"name":"名字"}"""))
    }

    @Test
    fun unknownTypeFallsBackToContentThenLabel() {
        assertEquals("内容", formatSearchMessageSummary("future_type", "内容"))
        assertEquals("[future_type]", formatSearchMessageSummary("future_type", ""))
    }
}
