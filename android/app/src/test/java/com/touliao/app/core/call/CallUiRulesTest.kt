package com.touliao.app.core.call

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallUiRulesTest {
    private fun p2p(stage: CallStage, minimized: Boolean = false) =
        CallState(stage = stage, peerId = "bob", isMinimized = minimized)

    private fun group(stage: GroupCallStage, minimized: Boolean = false) =
        GroupCallState(stage = stage, callId = "g1", conversationId = "c1", isMinimized = minimized)

    private val idle = CallState()
    private val groupIdle = GroupCallState()

    // ── isP2pActive / isGroupActive ──

    @Test
    fun p2pActiveStages() {
        assertFalse(CallUiRules.isP2pActive(CallStage.IDLE))
        assertTrue(CallUiRules.isP2pActive(CallStage.OUTGOING))
        assertFalse(CallUiRules.isP2pActive(CallStage.INCOMING))
        assertTrue(CallUiRules.isP2pActive(CallStage.CONNECTING))
        assertTrue(CallUiRules.isP2pActive(CallStage.CONNECTED))
        assertFalse(CallUiRules.isP2pActive(CallStage.ENDED))
    }

    @Test
    fun groupActiveStages() {
        assertFalse(CallUiRules.isGroupActive(GroupCallStage.IDLE))
        assertTrue(CallUiRules.isGroupActive(GroupCallStage.CONNECTING))
        assertTrue(CallUiRules.isGroupActive(GroupCallStage.CONNECTED))
        assertFalse(CallUiRules.isGroupActive(GroupCallStage.ENDED))
    }

    // ── displayKind ──

    @Test
    fun displayKindNoneWhenBothIdle() {
        assertEquals(CallUiKind.NONE, CallUiRules.displayKind(idle, groupIdle))
    }

    @Test
    fun displayKindP2pWinsOverGroup() {
        assertEquals(CallUiKind.P2P, CallUiRules.displayKind(p2p(CallStage.INCOMING), group(GroupCallStage.CONNECTED)))
        assertEquals(CallUiKind.P2P, CallUiRules.displayKind(p2p(CallStage.CONNECTED), group(GroupCallStage.CONNECTING)))
    }

    @Test
    fun displayKindP2pEndedStillWinsOverGroup() {
        assertEquals(CallUiKind.P2P, CallUiRules.displayKind(p2p(CallStage.ENDED), group(GroupCallStage.CONNECTED)))
    }

    @Test
    fun displayKindGroupWhenP2pIdle() {
        assertEquals(CallUiKind.GROUP, CallUiRules.displayKind(idle, group(GroupCallStage.CONNECTED)))
        assertEquals(CallUiKind.GROUP, CallUiRules.displayKind(idle, group(GroupCallStage.ENDED)))
    }

    // ── mainShouldOpenCallUi ──

    @Test
    fun opensForIncoming() {
        assertTrue(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.INCOMING), groupIdle, callUiStarted = false))
    }

    @Test
    fun opensForEnded() {
        assertTrue(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.ENDED), groupIdle, callUiStarted = false))
    }

    @Test
    fun opensForActiveP2pNotMinimized() {
        assertTrue(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.OUTGOING), groupIdle, callUiStarted = false))
        assertTrue(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.CONNECTING), groupIdle, callUiStarted = false))
        assertTrue(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.CONNECTED), groupIdle, callUiStarted = false))
    }

    @Test
    fun doesNotOpenForMinimizedP2p() {
        assertFalse(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.CONNECTED, minimized = true), groupIdle, callUiStarted = false))
        assertFalse(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.OUTGOING, minimized = true), groupIdle, callUiStarted = false))
    }

    @Test
    fun neverOpensWhenCallUiAlreadyStarted() {
        assertFalse(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.INCOMING), groupIdle, callUiStarted = true))
        assertFalse(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.ENDED), groupIdle, callUiStarted = true))
        assertFalse(CallUiRules.mainShouldOpenCallUi(p2p(CallStage.CONNECTED), groupIdle, callUiStarted = true))
        assertFalse(CallUiRules.mainShouldOpenCallUi(idle, group(GroupCallStage.CONNECTED), callUiStarted = true))
    }

    @Test
    fun opensForActiveGroupNotMinimized() {
        assertTrue(CallUiRules.mainShouldOpenCallUi(idle, group(GroupCallStage.CONNECTING), callUiStarted = false))
        assertTrue(CallUiRules.mainShouldOpenCallUi(idle, group(GroupCallStage.CONNECTED), callUiStarted = false))
    }

    @Test
    fun doesNotOpenForMinimizedGroup() {
        assertFalse(CallUiRules.mainShouldOpenCallUi(idle, group(GroupCallStage.CONNECTED, minimized = true), callUiStarted = false))
    }

    @Test
    fun doesNotOpenForGroupEnded() {
        assertFalse(CallUiRules.mainShouldOpenCallUi(idle, group(GroupCallStage.ENDED), callUiStarted = false))
    }

    @Test
    fun doesNotOpenWhenAllIdle() {
        assertFalse(CallUiRules.mainShouldOpenCallUi(idle, groupIdle, callUiStarted = false))
    }

    // ── bubbleKind ──

    @Test
    fun bubbleForMinimizedActiveP2p() {
        assertEquals(CallUiKind.P2P, CallUiRules.bubbleKind(p2p(CallStage.CONNECTED, minimized = true), groupIdle))
        assertEquals(
            CallUiKind.P2P,
            CallUiRules.bubbleKind(p2p(CallStage.CONNECTED, minimized = true), group(GroupCallStage.CONNECTED, minimized = true)),
        )
    }

    @Test
    fun bubbleForMinimizedActiveGroup() {
        assertEquals(CallUiKind.GROUP, CallUiRules.bubbleKind(idle, group(GroupCallStage.CONNECTING, minimized = true)))
        assertEquals(
            CallUiKind.GROUP,
            CallUiRules.bubbleKind(p2p(CallStage.CONNECTED, minimized = false), group(GroupCallStage.CONNECTED, minimized = true)),
        )
    }

    @Test
    fun noBubbleWhenNotMinimizedOrNotActive() {
        assertEquals(CallUiKind.NONE, CallUiRules.bubbleKind(idle, groupIdle))
        assertEquals(CallUiKind.NONE, CallUiRules.bubbleKind(p2p(CallStage.CONNECTED), group(GroupCallStage.CONNECTED)))
        // 响铃、结束态即使 isMinimized 为 true 也不画小窗
        assertEquals(CallUiKind.NONE, CallUiRules.bubbleKind(p2p(CallStage.INCOMING, minimized = true), groupIdle))
        assertEquals(CallUiKind.NONE, CallUiRules.bubbleKind(p2p(CallStage.ENDED, minimized = true), groupIdle))
        assertEquals(CallUiKind.NONE, CallUiRules.bubbleKind(idle, group(GroupCallStage.ENDED, minimized = true)))
    }

    // ── turnScreenOn ──

    @Test
    fun turnScreenOnOnlyWhileRinging() {
        assertTrue(CallUiRules.turnScreenOn(p2p(CallStage.INCOMING)))
        for (stage in CallStage.values().filter { it != CallStage.INCOMING }) {
            assertFalse("stage=$stage", CallUiRules.turnScreenOn(p2p(stage)))
        }
    }
}
