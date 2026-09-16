package com.touliao.app.core.storage

import com.touliao.app.core.network.AuthInterceptor
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

class CredentialIsolationTest {
    @Test fun `late password response cannot replace current account or ABA credential`() {
        for (aba in listOf(false, true)) {
            val store = TokenStore(memoryPreferences()).apply { token = "fixture-A" }
            val request = store.snapshot()
            store.token = "fixture-B"
            if (aba) store.token = "fixture-A"
            var accountSlot = "untouched"
            assertFalse(store.installReplacement(request, "late-new-A") { accountSlot = "overwritten" })
            assertEquals(if (aba) "fixture-A" else "fixture-B", store.token)
            assertEquals("untouched", accountSlot)
        }
    }
    @Test fun `current password response installs both credential and account slot`() {
        val store = TokenStore(memoryPreferences()).apply { token = "fixture-A" }
        val request = store.snapshot()
        var accountSlot = "fixture-A"
        assertTrue(store.installReplacement(request, "new-A") { accountSlot = "new-A" })
        assertEquals("new-A", store.token)
        assertEquals("new-A", accountSlot)
        assertFalse(store.isCurrent(request))
        assertEquals(request.identityEpoch, store.snapshot().identityEpoch)
    }
    @Test fun `queued unauthorized marker cannot log out next login`() {
        val store = TokenStore(memoryPreferences())
        store.token = "fixture-A"
        val marker = store.invalidate(store.snapshot())!!
        store.token = "fixture-B"
        var loggedOut = false
        store.withCurrent(marker) { loggedOut = true }
        assertFalse(loggedOut)
        assertEquals("fixture-B", store.token)
    }
    @Test fun `identity switch freezes immediately but credential rotation permits fresh action`() {
        val store = TokenStore(memoryPreferences())
        store.token = "fixture-A"
        val old = store.snapshot()
        store.token = "fixture-new-A"
        assertFalse(store.isCurrent(old))
        assertEquals(old.identityEpoch, store.snapshot().identityEpoch)
        val fresh = store.snapshot()
        store.beginIdentityChange()
        assertFalse(store.withCurrent(fresh) { fail("Old emission ran") })
        assertTrue(store.snapshot().identityEpoch > fresh.identityEpoch)
    }
    private fun late401(store: TokenStore, change: () -> Unit) {
        val request = Request.Builder().url("https://fixture.test/api/messages").build()
        val chain = Proxy.newProxyInstance(Interceptor.Chain::class.java.classLoader,
            arrayOf(Interceptor.Chain::class.java)) { _, method, args ->
            when (method.name) {
                "request" -> request
                "proceed" -> {
                    change()
                    Response.Builder().request(args!![0] as Request).protocol(Protocol.HTTP_1_1).code(401).message("fixture").build()
                }
                else -> error("Unexpected chain operation ${method.name}")
            }
        } as Interceptor.Chain
        AuthInterceptor(store).intercept(chain)
    }
    @Test fun `late A401 cannot clear newly installed B credential`() {
        val store = TokenStore(memoryPreferences())
        store.token = "fixture-A"
        late401(store) { store.token = "fixture-B" }
        assertEquals("fixture-B", store.token)
    }
    @Test fun `ABA credential string does not resurrect old request`() {
        val store = TokenStore(memoryPreferences())
        store.token = "fixture-A"
        late401(store) { store.token = "fixture-B"; store.token = "fixture-A" }
        assertEquals("fixture-A", store.token)
    }
    @Test fun `current 401 still clears credential`() {
        val store = TokenStore(memoryPreferences())
        store.token = "fixture-A"
        late401(store) {}
        assertNull(store.token)
    }
}
