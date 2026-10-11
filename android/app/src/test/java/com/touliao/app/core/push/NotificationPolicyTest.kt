package com.touliao.app.core.push

import org.junit.Assert.*
import org.junit.Test

class NotificationPolicyTest {
    @Test fun identitiesAreScopedToAccountAndConversation() {
        assertEquals("touliao:A:c1", NotificationPolicy.tag("A", "c1"))
        assertNotEquals(NotificationPolicy.tag("A", "c1"), NotificationPolicy.tag("B", "c1"))
        assertNotEquals(NotificationPolicy.vendorId("A", "c1"), NotificationPolicy.vendorId("A", "c2"))
        assertTrue(NotificationPolicy.vendorId("A", "c1") > 0)
    }
    @Test fun silentAndVibrationOnlyUseDistinctChannels() {
        assertEquals("touliao_messages_s0_v0", NotificationPolicy.channel(false, false))
        assertEquals("touliao_messages_s0_v1", NotificationPolicy.channel(false, true))
        assertEquals("touliao_messages_s1_v0", NotificationPolicy.channel(true, false))
        assertEquals("touliao_messages_s1_v1", NotificationPolicy.channel(true, true))
    }
}
