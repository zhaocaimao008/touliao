package com.touliao.app.data.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MergedForward 纯函数单测 —— 对齐 Web utils/mergedForward.js 语义（F4a #2）。
 * 覆盖：类型过滤、30 条上限、摘要文案、JSON 往返、损坏 content 不崩、HTTP body 字段名契约。
 */
class MergedForwardTest {

    private fun msg(
        id: String,
        type: String = "text",
        content: String = "",
        senderName: String = "张三",
        createdAt: Long = 1700000000,
        duration: Int = 0,
        deleted: Int = 0,
    ) = Message(
        id = id, conversation_id = "c1", sender_id = "u1", type = type,
        content = content, created_at = createdAt, senderName = senderName,
        duration = duration, deleted = deleted,
    )

    @Test
    fun filtersUnforwardableAndDeletedMessages() {
        val input = listOf(
            msg("m1", "text", "hello"),
            msg("m2", "red_packet", "恭喜发财"),
            msg("m3", "transfer", "转账"),
            msg("m4", "call", "语音通话 30 秒"),
            msg("m5", "nudge", "拍了拍"),
            msg("m6", "text", "deleted", deleted = 1),
            msg("m7", "image", "a.jpg"),
            msg("m8", "voice", "", duration = 8),
            msg("m9", "video", "v.mp4"),
            msg("m10", "file", "doc.pdf"),
            msg("m11", "contact_card", """{"username":"李四"}"""),
            msg("m12", "merged", """{"title":"XX的聊天记录","items":[]}"""),
        )
        val payload = buildMergedPayload(input, "标题")
        assertEquals(listOf("m1", "m7", "m8", "m9", "m10", "m11", "m12"), payload.items.map { it.mid })
    }

    @Test
    fun capsPayloadAtThirtyItemsKeepingOrder() {
        val input = (1..45).map { msg("m$it", "text", "msg$it") }
        val payload = buildMergedPayload(input, "")
        assertEquals(30, payload.items.size)
        // 截前 30 条且保持传入（时间）顺序
        assertEquals((1..30).map { "m$it" }, payload.items.map { it.mid })
        // 空 title 回退为条数字符串（对齐 Web `${items.length}`）
        assertEquals("30", payload.title)
    }

    @Test
    fun snippetsUseChineseTypeLabels() {
        assertEquals(
            "[图片] a.jpg",
            mergedSnippetOf(msg("m1", "image", "a.jpg")),
        )
        assertEquals(
            "[语音] 8″",
            mergedSnippetOf(msg("m2", "voice", "", duration = 8)),
        )
        assertEquals(
            "[语音]",
            mergedSnippetOf(msg("m3", "voice", "")),
        )
        assertEquals(
            "[名片] 李四",
            mergedSnippetOf(msg("m4", "contact_card", """{"username":"李四","uid":"u9"}""")),
        )
        assertEquals(
            "[聊天记录] XX的聊天记录",
            mergedSnippetOf(msg("m5", "merged", """{"title":"XX的聊天记录","items":[]}""")),
        )
        assertEquals(
            "[文件] doc.pdf",
            mergedSnippetOf(msg("m6", "file", "doc.pdf")),
        )
    }

    @Test
    fun textSnippetTruncatedToEightyChars() {
        val long = "a".repeat(200)
        assertEquals(80, mergedSnippetOf(msg("m1", "text", long)).length)
    }

    @Test
    fun encodeParseRoundTripPreservesFields() {
        val payload = buildMergedPayload(
            listOf(
                msg("m1", "text", "hello", senderName = "甲", createdAt = 111),
                msg("m2", "image", "p.jpg", senderName = "乙", createdAt = 222),
            ),
            "对话的聊天记录",
        )
        val decoded = parseMergedContent(payload.encodeToJson())
        assertEquals("对话的聊天记录", decoded.title)
        assertEquals(2, decoded.items.size)
        assertEquals(MergedForwardItem(mid = "m1", type = "text", sender = "u1", senderName = "甲", snippet = "hello", ts = 111), decoded.items[0])
        assertEquals("m2", decoded.items[1].mid)
        assertEquals(222, decoded.items[1].ts)
    }

    @Test
    fun parseInvalidContentFallsBackToEmptyInsteadOfCrash() {
        val decoded = parseMergedContent("not a json {{{")
        assertEquals("", decoded.title)
        assertTrue(decoded.items.isEmpty())
    }

    @Test
    fun forwardableWhitelistMatchesWeb() {
        listOf("text", "image", "voice", "video", "file", "contact_card", "merged").forEach {
            assertTrue("type=$it 应可合并转发", isForwardableMessage(msg("m", it)))
        }
        listOf("red_packet", "transfer", "call", "nudge", "sticker", "location", "unknown_x").forEach {
            assertFalse("type=$it 不可合并转发", isForwardableMessage(msg("m", it)))
        }
    }

    @Test
    fun sendMessageBodySerializesBackendFieldNames() {
        val json = Json.encodeToString(
            SendMessageBody.serializer(),
            SendMessageBody(content = """{"title":"t"}""", type = "merged", replyToId = "r1"),
        )
        assertTrue(json.contains("\"type\":\"merged\""))
        assertTrue(json.contains("\"reply_to_id\":\"r1\""))
        assertTrue(json.contains("\"content\""))
    }
}
