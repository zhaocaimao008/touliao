package com.touliao.app.core.storage
import com.touliao.app.core.realtime.SocialReadGuard
import org.junit.Assert.*
import org.junit.Test
class SocialReadGuardTest {
    @Test fun `old response duplicate event offline reconcile and ABA are fenced`() {
        var epoch = 1L; var revision = 0L
        val guard = SocialReadGuard({ epoch }, { revision })
        val old = guard.begin()!!; assertTrue(guard.current(old))
        revision++ // permission event or reconnect
        assertFalse(guard.current(old))
        val first = guard.begin()!!; val second = guard.begin()!!
        assertFalse(guard.current(first)); assertTrue(guard.current(second))
        epoch += 2 // A -> B -> A
        assertFalse(guard.current(second)); assertNull(guard.begin())
    }
}
