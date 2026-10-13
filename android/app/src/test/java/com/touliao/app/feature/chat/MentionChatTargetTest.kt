package com.touliao.app.feature.chat

import com.touliao.app.data.model.Conversation
import com.touliao.app.data.model.ConversationOtherUser
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 「@我」条目 → 聊天页跳转参数：按会话列表回填会话类型/私聊对方，群聊不再被当成私聊打开。
 */
class MentionChatTargetTest {

    @Test
    fun groupConversationKeepsGroupType() {
        val conv = Conversation(id = "g1", type = "group", name = "项目群")
        assertEquals(
            MentionChatTarget(conversationId = "g1", title = "项目群", type = "group", peerUserId = ""),
            mentionChatTarget("g1", "项目群", conv),
        )
    }

    @Test
    fun privateConversationUsesListNameAndPeer() {
        val conv = Conversation(id = "p1", type = "private", name = "张三", otherUser = ConversationOtherUser(id = "u2", username = "张三"))
        assertEquals(
            MentionChatTarget(conversationId = "p1", title = "张三", type = "private", peerUserId = "u2"),
            mentionChatTarget("p1", "私聊", conv),
        )
    }

    @Test
    fun blankListNameFallsBackToMentionName() {
        val conv = Conversation(id = "g1", type = "group", name = "")
        assertEquals("项目群", mentionChatTarget("g1", "项目群", conv).title)
    }

    @Test
    fun unknownConversationFallsBackToGroup() {
        assertEquals(
            MentionChatTarget(conversationId = "x", title = "某群", type = "group", peerUserId = ""),
            mentionChatTarget("x", "某群", null),
        )
    }

    @Test
    fun unknownPrivateConversationFallsBackToPrivate() {
        // 私聊在 @我 接口里名字固定是「私聊」：列表里找不到（如已隐藏）时仍按私聊打开，不误开成群聊
        assertEquals(
            MentionChatTarget(conversationId = "p9", title = "私聊", type = "private", peerUserId = ""),
            mentionChatTarget("p9", "私聊", null),
        )
    }
}
