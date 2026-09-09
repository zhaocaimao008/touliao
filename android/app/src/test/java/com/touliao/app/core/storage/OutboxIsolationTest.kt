package com.touliao.app.core.storage

import com.touliao.app.data.model.Message
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class OutboxIsolationTest {
    @Test fun `server and owner isolate group and direct queues across restart`() {
        val prefs = memoryPreferences()
        val store = OutboxStore(prefs)
        val a = OutboxOwner("https://one.test", "A")
        val b = a.copy(accountId = "B")
        for (conv in listOf("same-group", "dm-a-b")) {
            val message = Message(id = "m1", conversation_id = conv, sender_id = "A", content = "A private")
            store.upsert(conv, message, a)
            assertTrue(store.load(conv, b).isEmpty())
            assertTrue(store.load(conv, a.copy(server = "https://two.test")).isEmpty())
            store.remove(conv, "m1", b)
            assertEquals("A private", OutboxStore(prefs).load(conv, a).single().content)
            store.upsert(conv, message, b)
            assertTrue(store.load(conv, b).isEmpty())
        }
    }
    @Test fun `capacity remains fifty per owner`() {
        val store = OutboxStore(memoryPreferences())
        val a = OutboxOwner("https://one.test", "A")
        val b = a.copy(accountId = "B")
        store.upsert("group", Message(id = "b1", conversation_id = "group", sender_id = "B", content = "B"), b)
        for (i in 0..50) store.upsert("group", Message(id = "m$i", conversation_id = "group", sender_id = "A", content = "A$i"), a)
        assertEquals(50, store.load("group", a).size)
        assertEquals("m1", store.load("group", a).first().id)
        assertEquals("b1", store.load("group", b).single().id)
    }
    @Test fun `legacy sender without server is retained but never restored`() {
        val prefs = memoryPreferences()
        val raw = Json.encodeToString(listOf(Message(id = "m1", conversation_id = "group", sender_id = "A", content = "A private")))
        prefs.edit().putString("group", raw).apply()
        assertTrue(OutboxStore(prefs).load("group").isEmpty())
        assertEquals(raw, prefs.getString("group", null))
    }
}
