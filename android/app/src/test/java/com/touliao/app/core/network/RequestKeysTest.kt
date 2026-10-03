package com.touliao.app.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class RequestKeysTest {
    @Test fun uncertainResponseReusesKeyButSuccessAndAccountChangeDoNot() {
        val keys = RequestKeys()
        val first = keys.key("server:account:1", "transfer", "amount=20")
        assertEquals(first, keys.key("server:account:1", "transfer", "amount=20"))
        assertNotEquals(first, keys.key("server:other:2", "transfer", "amount=20"))
        assertNotEquals(first, keys.key("server:account:1", "transfer", "amount=21"))
        keys.complete("server:account:1", "transfer", "amount=20", first)
        assertNotEquals(first, keys.key("server:account:1", "transfer", "amount=20"))
    }
}
