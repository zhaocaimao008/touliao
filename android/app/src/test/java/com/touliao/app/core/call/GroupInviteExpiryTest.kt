package com.touliao.app.core.call

import org.junit.Assert.assertEquals
import org.junit.Test

class GroupInviteExpiryTest {
    private val now = 1_700_000_000_000L

    @Test
    fun missingExpiresAtFallsBackToMaxTtl() {
        assertEquals(60_000L, GroupInviteExpiry.remainingMs(0L, now))
    }

    @Test
    fun negativeExpiresAtFallsBackToMaxTtl() {
        assertEquals(60_000L, GroupInviteExpiry.remainingMs(-1L, now))
        assertEquals(GroupInviteExpiry.MAX_TTL_MS, GroupInviteExpiry.remainingMs(Long.MIN_VALUE, now))
    }

    @Test
    fun alreadyExpiredReturnsZero() {
        assertEquals(0L, GroupInviteExpiry.remainingMs(now, now))
        assertEquals(0L, GroupInviteExpiry.remainingMs(now - 1L, now))
        assertEquals(0L, GroupInviteExpiry.remainingMs(now - 120_000L, now))
    }

    @Test
    fun farFutureIsClampedToMaxTtl() {
        assertEquals(60_000L, GroupInviteExpiry.remainingMs(now + 60_001L, now))
        assertEquals(60_000L, GroupInviteExpiry.remainingMs(now + 10 * 60_000L, now))
    }

    @Test
    fun normalValueIsReturnedAsIs() {
        assertEquals(45_000L, GroupInviteExpiry.remainingMs(now + 45_000L, now))
        assertEquals(60_000L, GroupInviteExpiry.remainingMs(now + 60_000L, now))
        assertEquals(1L, GroupInviteExpiry.remainingMs(now + 1L, now))
    }
}
