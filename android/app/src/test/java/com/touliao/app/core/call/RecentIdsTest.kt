package com.touliao.app.core.call

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecentIdsTest {

    @Test
    fun firstAddTrueDuplicateFalse() {
        val ids = RecentIds(4)
        assertTrue(ids.add("a"))
        assertFalse(ids.add("a"))
        assertTrue("a" in ids)
    }

    @Test
    fun emptyIdIsNeverRecorded() {
        val ids = RecentIds(4)
        assertFalse(ids.add(""))
        assertFalse("" in ids)
    }

    @Test
    fun unknownIdNotContained() {
        val ids = RecentIds(4)
        ids.add("a")
        assertFalse("b" in ids)
    }

    @Test
    fun oldestEvictedWhenOverMax() {
        val ids = RecentIds(2)
        assertTrue(ids.add("a"))
        assertTrue(ids.add("b"))
        assertTrue(ids.add("c"))
        assertFalse("a" in ids)
        assertTrue("b" in ids)
        assertTrue("c" in ids)
    }

    @Test
    fun evictedIdCanBeAddedAgain() {
        val ids = RecentIds(2)
        ids.add("a")
        ids.add("b")
        ids.add("c")
        assertTrue(ids.add("a"))
        assertTrue("a" in ids)
        // 再次加入 a 后淘汰的是当时最旧的 b
        assertFalse("b" in ids)
        assertTrue("c" in ids)
    }

    @Test(expected = IllegalArgumentException::class)
    fun maxMustBePositive() {
        RecentIds(0)
    }
}
