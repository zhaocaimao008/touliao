package com.touliao.app.core.call

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallSignalMatcherTest {
    @Test
    fun staleCallIdIsRejected() {
        assertFalse(CallSignalMatcher.matches("new", "old", "bob", "bob"))
    }

    @Test
    fun currentCallAndPeerAreAccepted() {
        assertTrue(CallSignalMatcher.matches("c1", "c1", "bob", "bob"))
    }

    @Test
    fun wrongPeerIsRejected() {
        assertFalse(CallSignalMatcher.matches("c1", "c1", "bob", "mallory"))
    }

    @Test
    fun emptyEventCallIdIsAcceptedForCompatibility() {
        assertTrue(CallSignalMatcher.matches("c1", "", "bob", "bob"))
    }

    @Test
    fun emptyActiveCallIdDoesNotAcceptNonEmptyEventCallId() {
        assertFalse(CallSignalMatcher.matches("", "c1", "bob", "bob"))
    }
}
