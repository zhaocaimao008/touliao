package com.touliao.app.core.storage

import com.touliao.app.core.network.AuthInterceptor
import com.touliao.app.core.network.HostSelectionInterceptor
import com.touliao.app.core.network.MediaAuthInterceptor
import com.touliao.app.core.network.cancelOnOriginChange
import com.touliao.app.data.model.Account
import kotlinx.serialization.json.Json
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import okhttp3.*
import org.junit.Assert.*
import org.junit.Test

class NativeOriginIsolationTest {
    private class Endpoint(private val response: String = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}") : AutoCloseable {
        private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 10000 }
        val origin = "http://127.0.0.1:${server.localPort}"
        val authorization = AtomicReference<String?>()
        val received = CountDownLatch(1)
        private val failure = AtomicReference<Throwable?>()
        private val thread = Thread {
            try {
                server.accept().use { socket ->
                    socket.soTimeout = 10000
                    val reader = socket.getInputStream().bufferedReader()
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                        if (line.startsWith("Authorization:", true)) authorization.set(line.substringAfter(":").trim())
                    }
                    received.countDown()
                    socket.getOutputStream().write(response.toByteArray())
                }
            } catch (error: Throwable) { failure.set(error) }
        }.apply { start() }
        override fun close() {
            server.close()
            thread.join(1000)
            assertFalse("Loopback receiver did not stop", thread.isAlive)
            failure.get()?.let { throw AssertionError("Loopback receiver failed", it) }
        }
    }

    private fun client(config: ServerConfig, tokens: TokenStore): OkHttpClient {
        val auth = AuthInterceptor(tokens)
        return OkHttpClient.Builder().addInterceptor(HostSelectionInterceptor(config))
            .addInterceptor(auth).addNetworkInterceptor(auth).build().cancelOnOriginChange(tokens)
    }

    @Test fun `original audit scenario no longer sends A credentials to B`() {
        val tokens = TokenStore(memoryPreferences())
        val config = ServerConfig(memoryPreferences(), tokens)
        config.baseUrl = "https://tenant-a.invalid"
        tokens.token = "synthetic-tenant-A-credential"
        val previous = tokens.snapshot()
        Endpoint().use { endpoint ->
            config.baseUrl = endpoint.origin
            val http = client(config, tokens)
            http.newCall(Request.Builder().url("https://tenant-a.invalid/api/config").build()).execute().use {
                assertEquals(200, it.code)
            }
            assertNull(endpoint.authorization.get())
            assertNull(tokens.token)
            assertFalse(tokens.isCurrent(previous))
            println("AUDIT FIXED: new origin received no Authorization header; old credential cleared")
        }
    }

    @Test fun `canonical origin preserves valid credentials but scheme host and port changes clear them`() {
        val tokens = TokenStore(memoryPreferences())
        val config = ServerConfig(memoryPreferences(), tokens)
        config.baseUrl = "https://TENANT-A.invalid:443/"
        tokens.token = "A"
        val same = tokens.snapshot()
        config.baseUrl = " https://tenant-a.invalid/path/ "
        assertEquals("https://tenant-a.invalid", tokens.origin)
        assertTrue(tokens.isCurrent(same))
        for (url in listOf("http://tenant-a.invalid", "http://tenant-a.invalid:81", "http://tenant-b.invalid:81")) {
            tokens.token = "must-clear"
            config.baseUrl = url
            assertNull(tokens.token)
        }
    }

    @Test fun `remote change and clearing manual override isolate only the effective server`() {
        val tokens = TokenStore(memoryPreferences())
        val config = ServerConfig(memoryPreferences(), tokens)
        config.setRemote("https://tenant-a.invalid")
        tokens.token = "A"
        config.setRemote("https://tenant-b.invalid")
        assertNull(tokens.token)
        config.baseUrl = "https://tenant-a.invalid"
        tokens.token = "A"
        val previous = tokens.snapshot()
        config.setRemote("https://tenant-c.invalid")
        assertTrue(tokens.isCurrent(previous))
        config.clearManualOverride()
        assertNull(tokens.token)
        assertEquals("https://tenant-c.invalid", tokens.origin)
    }

    @Test fun `origin binding survives restart and refuses unbound legacy credentials`() {
        val prefs = memoryPreferences()
        prefs.edit().putString("vxin_token", "legacy-unbound").apply()
        val tokens = TokenStore(prefs)
        assertNull(tokens.token)
        val configPrefs = memoryPreferences()
        val config = ServerConfig(configPrefs, tokens)
        config.baseUrl = "https://tenant-a.invalid"
        tokens.token = "A"
        val restored = TokenStore(prefs)
        val restoredConfig = ServerConfig(configPrefs, restored)
        assertEquals("A", restored.token)
        restoredConfig.baseUrl = "https://tenant-b.invalid"
        assertNull(TokenStore(prefs).token)
        assertFalse(restored.installReplacement(tokens.snapshot(), "late-A") { fail("Stale response installed") })
    }

    @Test fun `saved accounts cannot reinstall credentials from another origin`() {
        val tokens = TokenStore(memoryPreferences())
        val accounts = AccountStore(memoryPreferences(), Json, tokens)
        tokens.selectOrigin("https://tenant-a.invalid")
        accounts.upsertActive(Account("shared-id", "A", "", "token-A"))
        tokens.selectOrigin("https://tenant-b.invalid")
        assertTrue(accounts.accounts().isEmpty())
        assertNull(accounts.tokenFor("shared-id"))
        assertNull(accounts.activeId())
        accounts.upsertActive(Account("shared-id", "B", "", "token-B"))
        tokens.selectOrigin("https://TENANT-A.invalid:443/")
        assertEquals("token-A", accounts.tokenFor("shared-id"))
    }

    @Test fun `matching origin sends token and cross-origin redirect strips it`() {
        val tokens = TokenStore(memoryPreferences())
        val config = ServerConfig(memoryPreferences(), tokens)
        Endpoint().use { b ->
            Endpoint("HTTP/1.1 302 Found\r\nLocation: ${b.origin}/api/config\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").use { a ->
                config.baseUrl = a.origin
                tokens.token = "A"
                client(config, tokens).newCall(Request.Builder().url("${a.origin}/api/config").build()).execute().use {
                    assertEquals(200, it.code)
                }
                assertEquals("Bearer A", a.authorization.get())
                assertNull(b.authorization.get())
            }
        }
    }

    @Test fun `final request boundary rejects a switch after host selection`() {
        val tokens = TokenStore(memoryPreferences())
        val config = ServerConfig(memoryPreferences(), tokens)
        config.baseUrl = "https://tenant-a.invalid"
        tokens.token = "A"
        val http = OkHttpClient.Builder().addInterceptor(HostSelectionInterceptor(config))
            .addInterceptor { chain -> config.baseUrl = "https://tenant-b.invalid"; chain.proceed(chain.request()) }
            .addInterceptor(AuthInterceptor(tokens)).build()
        try {
            http.newCall(Request.Builder().url("https://tenant-a.invalid/api/config").build()).execute().close()
            fail("Stale request reached network")
        } catch (expected: IOException) { assertEquals("Account changed before request", expected.message) }
    }

    @Test fun `foreign request cannot send an explicitly supplied stale Authorization header`() {
        val tokens = TokenStore(memoryPreferences()).apply { selectOrigin("https://tenant-a.invalid"); token = "A" }
        Endpoint().use { b ->
            val auth = AuthInterceptor(tokens)
            val http = OkHttpClient.Builder().addInterceptor(auth).addNetworkInterceptor(auth).build()
            http.newCall(Request.Builder().url("${b.origin}/api/config").header("Authorization", "Bearer A").build()).execute().close()
            assertNull(b.authorization.get())
        }
    }

    @Test fun `media requests also refuse foreign credentials`() {
        val tokens = TokenStore(memoryPreferences())
        val config = ServerConfig(memoryPreferences(), tokens)
        config.baseUrl = "https://tenant-a.invalid"
        tokens.token = "A"
        Endpoint().use { b ->
            val media = MediaAuthInterceptor(config, tokens)
            val http = OkHttpClient.Builder().addInterceptor(media).addNetworkInterceptor(media).build()
            http.newCall(Request.Builder().url("${b.origin}/uploads/file").header("Authorization", "Bearer A").build()).execute().close()
            assertNull(b.authorization.get())
        }
    }

    @Test fun `server switch cancels running and queued calls synchronously`() {
        val tokens = TokenStore(memoryPreferences())
        val config = ServerConfig(memoryPreferences(), tokens)
        config.baseUrl = "https://tenant-a.invalid"
        tokens.token = "A"
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val done = CountDownLatch(2)
        val dispatcher = Dispatcher().apply { maxRequests = 1 }
        val http = OkHttpClient.Builder().dispatcher(dispatcher).addInterceptor { chain ->
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            chain.proceed(chain.request())
        }.addInterceptor(AuthInterceptor(tokens)).build().cancelOnOriginChange(tokens)
        val callback = object : Callback {
            override fun onFailure(call: Call, e: IOException) { done.countDown() }
            override fun onResponse(call: Call, response: Response) { response.close(); done.countDown() }
        }
        val first = http.newCall(Request.Builder().url("https://tenant-a.invalid/api/config").build())
        val queued = http.newCall(Request.Builder().url("https://tenant-a.invalid/api/config").build())
        try {
            first.enqueue(callback)
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            queued.enqueue(callback)
            assertEquals(1, dispatcher.queuedCallsCount())
            config.baseUrl = "https://tenant-b.invalid"
            assertTrue(first.isCanceled())
            assertTrue(queued.isCanceled())
        } finally {
            release.countDown()
            assertTrue(done.await(5, TimeUnit.SECONDS))
            dispatcher.executorService.shutdownNow()
        }
    }

    @Test fun `server switch invokes SocketManager disconnect and removes old listeners`() {
        val tokens = TokenStore(memoryPreferences())
        val config = ServerConfig(memoryPreferences(), tokens)
        config.baseUrl = "https://tenant-a.invalid"
        tokens.token = "A"
        // Storage is unused by disconnect; only bypass its Android constructor boundary.
        val unsafeType = Class.forName("sun.misc.Unsafe")
        val field = unsafeType.getDeclaredField("theUnsafe").apply { isAccessible = true }
        val cache = unsafeType.getMethod("allocateInstance", Class::class.java)
            .invoke(field.get(null), MsgCacheStore::class.java) as MsgCacheStore
        val manager = com.touliao.app.core.realtime.SocketManager(tokens, config, cache, Json)
        var disconnected = false
        val connection = object : io.socket.client.Socket(null, "/", io.socket.client.IO.Options()) {
            override fun disconnect(): io.socket.client.Socket { disconnected = true; return this }
        }
        connection.on("new_message") { fail("Old listener remained installed") }
        val socketField = manager.javaClass.getDeclaredField("socket").apply { isAccessible = true }
        socketField.set(manager, connection)
        config.baseUrl = "https://tenant-b.invalid"
        assertTrue(disconnected)
        assertNull(socketField.get(manager))
        assertFalse(connection.hasListeners("new_message"))
        assertEquals(com.touliao.app.core.realtime.SocketStatus.DISCONNECTED, manager.status.value)
    }
}
