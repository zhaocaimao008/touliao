package com.touliao.app.feature.chat

import com.touliao.app.core.storage.*
import com.touliao.app.data.model.Message
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class OwnedTextSenderTest {
    private val owner = OutboxOwner("https://one.test", "A")
    private val message = Message(id = "m1", conversation_id = "group", sender_id = "A", content = "A private")

    @Test fun `failed retry remains persisted while suspended and stale ACK never removes it`() = runBlocking {
        for (changeIdentity in listOf(false, true)) {
            val tokens = TokenStore(memoryPreferences()).apply { token = "fixture-A" }
            val outbox = OutboxStore(memoryPreferences())
            outbox.upsert("group", message, owner)
            val ack = CompletableDeferred<Result<Message>>()
            val captured = tokens.snapshot()
            val ui = mutableListOf<String>()
            val task = launch(start = CoroutineStart.UNDISPATCHED) {
                sendOwnedText(message, owner, captured, tokens, outbox,
                    send = { ack.await() }, onSuccess = { ui += it.id }, onFailure = { ui += "error" })
            }
            assertEquals("A private", outbox.load("group", owner).single().content)
            if (changeIdentity) tokens.beginIdentityChange()
            tokens.token = "fixture-B"
            tokens.token = "fixture-A"
            ack.complete(Result.success(message.copy(id = "real")))
            task.join()
            assertTrue(ui.isEmpty())
            assertEquals(1, outbox.load("group", owner).size)
            var emitted = false
            sendOwnedText(message, owner, captured, tokens, outbox,
                send = { emitted = true; Result.success(message) }, onSuccess = {}, onFailure = {})
            assertFalse(emitted)
            sendOwnedText(message, owner, tokens.snapshot(), tokens, outbox,
                send = { Result.success(message.copy(id = "real")) }, onSuccess = { ui += it.id }, onFailure = {})
            assertEquals(listOf("real"), ui)
            assertTrue(outbox.load("group", owner).isEmpty())
        }
    }

    @Test fun `late failure and foreign sender cannot write another owner queue`() = runBlocking {
        val tokens = TokenStore(memoryPreferences()).apply { token = "fixture-A" }
        val outbox = OutboxStore(memoryPreferences())
        val captured = tokens.snapshot()
        sendOwnedText(message, owner, captured, tokens, outbox,
            send = { tokens.beginIdentityChange(); Result.failure(IllegalStateException("offline")) },
            onSuccess = { fail("stale success") }, onFailure = { fail("stale failure") })
        assertTrue(outbox.load("group", owner).isEmpty())
        sendOwnedText(message.copy(sender_id = "B"), owner, tokens.snapshot(), tokens, outbox,
            send = { fail("foreign send"); Result.success(message) }, onSuccess = {}, onFailure = {})
        assertTrue(outbox.load("group", owner).isEmpty())
    }
}
