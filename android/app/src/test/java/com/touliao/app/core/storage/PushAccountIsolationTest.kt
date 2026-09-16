package com.touliao.app.core.storage

import com.touliao.app.core.network.AuthInterceptor
import com.touliao.app.core.push.PushRecipient
import com.touliao.app.core.push.PushRegistrationQueue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Request
import java.io.IOException
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

class PushAccountIsolationTest {
    @Test fun `queued old request cannot borrow B credentials even after ABA`() {
        for (aba in listOf(false, true)) {
            val credentials = TokenStore(memoryPreferences()).apply { token = "A" }
            val owner = credentials.snapshot()
            val request = Request.Builder().url("https://fixture.invalid/api/notifications/device-token")
                .tag(TokenStore.Snapshot::class.java, owner).build()
            credentials.token = "B"
            if (aba) credentials.token = "A"
            val chain = Proxy.newProxyInstance(Interceptor.Chain::class.java.classLoader,
                arrayOf(Interceptor.Chain::class.java)) { _, method, _ ->
                if (method.name == "request") request else error("Stale request reached network")
            } as Interceptor.Chain
            try { AuthInterceptor(credentials).intercept(chain); fail("Expected stale request rejection") }
            catch (_: IOException) {}
            assertEquals(if (aba) "A" else "B", credentials.token)
        }
    }

    @Test fun `switch drains register then deletes and skips stale queued register`() = runBlocking {
        val credentials = TokenStore(memoryPreferences()).apply { token = "A" }
        val queue = PushRegistrationQueue(credentials)
        val old = credentials.snapshot()
        val release = CompletableDeferred<Unit>()
        val events = mutableListOf<String>()
        val register = async(start = CoroutineStart.UNDISPATCHED) {
            queue.run(old) { events += "register-start"; release.await(); events += "register-end" }
        }
        credentials.beginIdentityChange()
        val cleanupOwner = credentials.snapshot()
        val cleanup = async(start = CoroutineStart.UNDISPATCHED) { queue.run(cleanupOwner) { events += "delete-A" } }
        val stale = async(start = CoroutineStart.UNDISPATCHED) { queue.run(old) { fail("Old registration ran") } }
        assertEquals(listOf("register-start"), events)
        release.complete(Unit)
        register.await(); cleanup.await()
        assertFalse(stale.await())
        credentials.token = "B"
        queue.run(credentials.snapshot()) { events += "register-B" }
        assertEquals(listOf("register-start", "register-end", "delete-A", "register-B"), events)
    }

    @Test fun `notification owner must match logged in account`() {
        assertTrue(PushRecipient.matches("A", "A", true))
        assertFalse(PushRecipient.matches("A", "B", true))
        assertFalse(PushRecipient.matches("A", "A", false))
        assertFalse(PushRecipient.matches(null, "A", true))
        assertFalse(PushRecipient.matches("", "", true))
    }
}
