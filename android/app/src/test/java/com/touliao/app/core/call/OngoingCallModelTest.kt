package com.touliao.app.core.call

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OngoingCallModelTest {

    private val idleGroup = GroupCallState()
    private val emptyRoster = GroupRoster()

    private fun p2p(stage: CallStage, video: Boolean = false, name: String = "小明", connectedAt: Long = 0L) =
        CallState(stage = stage, peerId = "u1", peerName = name, isVideo = video, callId = "c1", connectedAt = connectedAt)

    private fun group(stage: GroupCallStage, video: Boolean = false, participants: List<String> = emptyList(), connectedAt: Long = 0L) =
        GroupCallState(stage = stage, callId = "g1", conversationId = "conv1", isVideo = video, participants = participants, connectedAt = connectedAt)

    @Test
    fun outgoingShowsCallingWithoutTimer() {
        val m = ongoingModelOf(p2p(CallStage.OUTGOING, connectedAt = 123L), idleGroup, emptyRoster)!!
        assertEquals(CallIntents.KIND_P2P, m.kind)
        assertEquals("c1", m.callId)
        assertEquals("小明", m.title)
        assertEquals("正在呼叫…", m.text)
        assertEquals(0L, m.connectedAtElapsed)
    }

    @Test
    fun connectingShowsConnectingWithoutTimer() {
        val m = ongoingModelOf(p2p(CallStage.CONNECTING, connectedAt = 123L), idleGroup, emptyRoster)!!
        assertEquals("连接中…", m.text)
        assertEquals(0L, m.connectedAtElapsed)
    }

    @Test
    fun connectedShowsKindAndTimer() {
        val audio = ongoingModelOf(p2p(CallStage.CONNECTED, connectedAt = 5_000L), idleGroup, emptyRoster)!!
        assertEquals("语音通话中", audio.text)
        assertEquals(5_000L, audio.connectedAtElapsed)
        assertEquals(false, audio.isVideo)

        val video = ongoingModelOf(p2p(CallStage.CONNECTED, video = true, connectedAt = 7_000L), idleGroup, emptyRoster)!!
        assertEquals("视频通话中", video.text)
        assertEquals(7_000L, video.connectedAtElapsed)
        assertEquals(true, video.isVideo)
    }

    @Test
    fun incomingEndedAndIdleHaveNoOngoingNotification() {
        assertNull(ongoingModelOf(p2p(CallStage.INCOMING), idleGroup, emptyRoster))
        assertNull(ongoingModelOf(p2p(CallStage.ENDED), idleGroup, emptyRoster))
        assertNull(ongoingModelOf(CallState(), idleGroup, emptyRoster))
        assertNull(ongoingModelOf(CallState(), GroupCallState(stage = GroupCallStage.ENDED), emptyRoster))
    }

    @Test
    fun blankPeerNameFallsBack() {
        val m = ongoingModelOf(p2p(CallStage.CONNECTED, name = "  ", connectedAt = 1L), idleGroup, emptyRoster)!!
        assertEquals("投聊通话", m.title)
    }

    @Test
    fun qualityAndSpeakerChangesDoNotChangeModel() {
        val base = p2p(CallStage.CONNECTED, connectedAt = 9_000L)
        val first = ongoingModelOf(base, idleGroup, emptyRoster)
        val second = ongoingModelOf(base.copy(callQuality = "poor", speakerOn = true), idleGroup, emptyRoster)
        assertEquals(first, second)
    }

    @Test
    fun groupConnectedShowsCountAndMatchingGroupName() {
        val roster = GroupRoster(conversationId = "conv1", groupName = "周末羽毛球")
        val m = ongoingModelOf(CallState(), group(GroupCallStage.CONNECTED, video = true, participants = listOf("a", "b"), connectedAt = 3_000L), roster)!!
        assertEquals(CallIntents.KIND_GROUP, m.kind)
        assertEquals("g1", m.callId)
        assertEquals("周末羽毛球", m.title)
        assertEquals("群视频通话 · 3人", m.text)
        assertEquals(3_000L, m.connectedAtElapsed)
    }

    @Test
    fun groupNameFromOtherConversationIsIgnored() {
        val roster = GroupRoster(conversationId = "other", groupName = "别的群")
        val m = ongoingModelOf(CallState(), group(GroupCallStage.CONNECTED, participants = listOf("a")), roster)!!
        assertEquals("群通话", m.title)
        assertEquals("群语音通话 · 2人", m.text)
    }

    @Test
    fun groupConnectingShowsJoiningWithoutTimer() {
        val m = ongoingModelOf(CallState(), group(GroupCallStage.CONNECTING, connectedAt = 4_000L), emptyRoster)!!
        assertEquals("正在加入群通话…", m.text)
        assertEquals(0L, m.connectedAtElapsed)
    }

    @Test
    fun p2pWinsWhenBothActive() {
        val m = ongoingModelOf(
            p2p(CallStage.CONNECTED, connectedAt = 1L),
            group(GroupCallStage.CONNECTED, participants = listOf("a")),
            GroupRoster(conversationId = "conv1", groupName = "群"),
        )!!
        assertEquals(CallIntents.KIND_P2P, m.kind)
        assertEquals("小明", m.title)
    }

    @Test
    fun placeholderIsP2pWithoutTimer() {
        val m = OngoingCallModel.placeholder(video = true)
        assertEquals(CallIntents.KIND_P2P, m.kind)
        assertEquals("", m.callId)
        assertEquals("投聊通话", m.title)
        assertEquals(true, m.isVideo)
        assertEquals(0L, m.connectedAtElapsed)
    }
}
