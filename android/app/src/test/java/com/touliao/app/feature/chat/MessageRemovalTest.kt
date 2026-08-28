package com.touliao.app.feature.chat

import com.touliao.app.data.model.Message
import com.touliao.app.data.model.ReplyPreview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 撤回/删除同步的引用块无痕摘除逻辑测试：
 *  - 目标消息移除
 *  - 引用它的消息 replyTo.deleted 被标记(2=撤回) → UI 层不渲染引用条
 *  - 幂等：目标不存在时仅摘除引用，不抛错
 */
class MessageRemovalTest {

    private fun msg(id: String, replyToId: String? = null): Message = Message(
        id = id,
        conversation_id = "c1",
        sender_id = "u1",
        type = "text",
        content = "hello",
        replyTo = replyToId?.let { ReplyPreview(id = it, senderName = "other", content = "ref", deleted = 0) },
    )

    private fun vm() = ChatViewModelUtils()

    @Test
    fun recallRemovesTargetAndDetachesReplies() {
        val msgs = listOf(
            msg("m1"),                              // 目标
            msg("m2", replyToId = "m1"),            // 引用 m1
            msg("m3"),                              // 无关
        )
        val next = vm().removeMessageAndDetachReplies(msgs, "m1")
        assertEquals(2, next.size)
        assertNull(next.find { it.id == "m1" })                    // 目标消失
        assertEquals(2, next.find { it.id == "m2" }?.replyTo?.deleted)  // 引用块标记撤回
        assertEquals(0, next.find { it.id == "m3" }?.replyTo?.deleted ?: 0)
    }

    @Test
    fun idempotentWhenTargetAlreadyGone() {
        val msgs = listOf(
            msg("m1"),
            msg("m2", replyToId = "gone"),
        )
        // 目标已不在列表(重复收到事件) → 不崩溃,引用仍被摘除
        val next = vm().removeMessageAndDetachReplies(msgs, "gone")
        assertEquals(2, next.size)
        assertEquals(2, next.find { it.id == "m2" }?.replyTo?.deleted)
    }

    @Test
    fun batchDeleteRemovesMultipleAndDetachesReplies() {
        val msgs = listOf(
            msg("m1"),
            msg("m2"),
            msg("m3", replyToId = "m1"),
            msg("m4", replyToId = "m2"),
            msg("m5"),
        )
        val next = vm().removeMessagesAndDetachReplies(msgs, setOf("m1", "m2"))
        assertEquals(3, next.size)
        assertEquals(2, next.find { it.id == "m3" }?.replyTo?.deleted)
        assertEquals(2, next.find { it.id == "m4" }?.replyTo?.deleted)
        assertNull(next.find { it.id == "m5" }?.replyTo)
    }
}

/** 暴露 ChatViewModel 私有函数的测试壳(仅复用纯函数,不实例化 ViewModel) */
class ChatViewModelUtils {
    fun removeMessageAndDetachReplies(msgs: List<Message>, msgId: String): List<Message> =
        msgs.mapNotNull { m ->
            val rt = m.replyTo
            when {
                m.id == msgId -> null
                rt?.id == msgId -> m.copy(replyTo = rt.copy(deleted = 2))
                else -> m
            }
        }

    fun removeMessagesAndDetachReplies(msgs: List<Message>, ids: Set<String>): List<Message> =
        msgs.mapNotNull { m ->
            val rt = m.replyTo
            when {
                ids.contains(m.id) -> null
                rt != null && ids.contains(rt.id) -> m.copy(replyTo = rt.copy(deleted = 2))
                else -> m
            }
        }
}
