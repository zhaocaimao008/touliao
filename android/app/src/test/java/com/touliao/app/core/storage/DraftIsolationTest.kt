package com.touliao.app.core.storage
import org.junit.Assert.*
import org.junit.Test
class DraftIsolationTest {
    @Test fun `switch restart delayed write ABA and environment cannot cross owners`() {
        val prefs = memoryPreferences()
        val store = DraftStore(prefs)
        val a = store.activate("https://one.test", "A", 1)
        store.set("group", "A private", a)
        val b = store.activate("https://one.test", "B", 2)
        assertEquals("", store.get("group", b))
        store.set("group", "late A", a)
        store.set("group", "B private", b)
        val again = store.activate("https://one.test", "A", 3)
        store.set("group", "ABA stale", a)
        assertEquals("A private", store.get("group", again))
        store.invalidate()
        assertEquals("", store.get("group", again))
        store.set("group", "logged out", again)
        val restarted = DraftStore(prefs)
        restarted.activate("https://one.test", "A", 0)
        assertEquals("A private", restarted.get("group"))
        restarted.activate("https://two.test", "A", 1)
        assertEquals("", restarted.get("group"))
        restarted.activate("https://one.test", "B", 2)
        assertEquals("B private", restarted.get("group"))
    }
    @Test fun `legacy text is not assigned and token identity change fences delayed writes`() {
        val prefs = memoryPreferences()
        prefs.edit().putString("group", "unowned legacy").apply()
        var epoch = 1L
        val store = DraftStore(prefs) { "https://one.test" to epoch }
        val a = store.activate("https://one.test", "A", epoch)
        assertEquals("", store.get("group"))
        store.set("group", "owned", a)
        epoch++
        store.set("group", "late", a)
        assertEquals("", store.get("group", a))
        store.activate("https://one.test", "A", epoch)
        assertEquals("owned", store.get("group"))
        assertEquals("unowned legacy", prefs.getString("group", null))
    }
}
