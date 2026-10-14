package com.touliao.app.feature.call

import com.touliao.app.core.call.CallStage
import com.touliao.app.core.call.CallState
import com.touliao.app.core.call.GroupCallStage
import com.touliao.app.core.call.GroupCallState
import com.touliao.app.core.call.GroupRoster
import org.junit.Assert.assertEquals
import org.junit.Test

/** 通话小窗读屏文字、群小窗头像名、群宫格昵称查找（CALL-1 / CALL-11 的纯函数部分） */
class CallBubbleTextTest {

    @Test
    fun p2pDescriptionMatchesLegacyWordingPerStage() {
        val base = CallState(peerName = "李明")
        // CallMinimizedBubbleTest 依赖这句原文
        assertEquals("与李明通话中，点按返回", p2pBubbleDescription(base.copy(stage = CallStage.CONNECTED)))
        assertEquals("与李明的通话已结束", p2pBubbleDescription(base.copy(stage = CallStage.ENDED)))
        assertEquals("正在连接李明，点按返回", p2pBubbleDescription(base.copy(stage = CallStage.OUTGOING)))
        assertEquals("正在连接李明，点按返回", p2pBubbleDescription(base.copy(stage = CallStage.CONNECTING)))
    }

    @Test
    fun p2pDescriptionFallsBackToGenericPeerWhenNameBlank() {
        assertEquals("与对方通话中，点按返回", p2pBubbleDescription(CallState(stage = CallStage.CONNECTED, peerName = " ")))
    }

    @Test
    fun groupDescriptionCountsSelfOnlyWhenConnected() {
        val connected = GroupCallState(stage = GroupCallStage.CONNECTED, participants = listOf("a", "b"))
        assertEquals("群通话中（3人），点按返回", groupBubbleDescription(connected))
        assertEquals("群通话中（1人），点按返回", groupBubbleDescription(connected.copy(participants = emptyList())))
        assertEquals("正在加入群通话，点按返回", groupBubbleDescription(connected.copy(stage = GroupCallStage.CONNECTING)))
    }

    @Test
    fun groupAvatarNameUsesRosterOnlyForSameConversation() {
        val state = GroupCallState(stage = GroupCallStage.CONNECTED, conversationId = "g1")
        assertEquals("产品群", groupBubbleAvatarName(state, GroupRoster(conversationId = "g1", groupName = "产品群")))
        // 名单属于别的群（上一次通话留下的）：不能拿来用
        assertEquals("群", groupBubbleAvatarName(state, GroupRoster(conversationId = "g2", groupName = "别的群")))
        // 同一个群但群名还没拉到
        assertEquals("群", groupBubbleAvatarName(state, GroupRoster(conversationId = "g1", groupName = "")))
    }

    @Test
    fun tileNameLooksUpNicknameOnlyForSameConversation() {
        val roster = GroupRoster(conversationId = "g1", names = mapOf("u1" to "小王", "u2" to " "))
        assertEquals("小王", groupTileName(roster, "g1", "u1"))
        // 昵称为空白、名单里没有：退回"群成员"
        assertEquals("群成员", groupTileName(roster, "g1", "u2"))
        assertEquals("群成员", groupTileName(roster, "g1", "u3"))
        // 名单属于别的群
        assertEquals("群成员", groupTileName(roster, "g2", "u1"))
    }
}
