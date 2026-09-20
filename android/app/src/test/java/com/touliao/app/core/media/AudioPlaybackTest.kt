package com.touliao.app.core.media
import org.junit.Assert.*
import org.junit.Test
class AudioPlaybackTest {
    private class Fake(val initFail: Boolean = false, val startFail: Boolean = false) : AudioPlayback.Device {
        var released = 0; var starts = 0
        lateinit var ready: () -> Unit; lateinit var done: () -> Unit; lateinit var failed: () -> Unit
        override fun prepare(url: String, ready: () -> Unit, done: () -> Unit, failed: () -> Unit) {
            this.ready=ready; this.done=done; this.failed=failed
            if (initFail) throw IllegalStateException("occupied")
        }
        override fun start() { if(startFail) throw IllegalStateException("error"); starts++ }
        override fun release() { released++ }
    }
    @Test fun completionAndExitReleaseOnce() {
        val d=Fake(); val p=AudioPlayback { d }; p.play("fixture") { fail(it) }
        d.ready(); d.done(); p.stop(); assertEquals(1,d.released)
    }
    @Test fun failuresAreVisibleAndRelease() {
        for (d in listOf(Fake(initFail=true),Fake(startFail=true),Fake())) {
            var errors=0; val p=AudioPlayback { d }; p.play("fixture") { errors++ }
            d.ready(); d.failed(); p.stop(); assertEquals(1,errors); assertEquals(1,d.released)
        }
    }
    @Test fun staleCallbacksCannotStopNewPlayback() {
        val a=Fake(); val b=Fake(); var n=0; val p=AudioPlayback { if(n++==0) a else b }
        p.play("a") { fail(it) }; p.play("b") { fail(it) }; a.ready(); a.failed(); a.done(); b.ready()
        assertEquals(0,a.starts); assertEquals(1,b.starts); assertEquals(0,b.released)
        p.stop(); b.ready(); assertEquals(1,b.starts)
    }
    @Test fun constructorFailureIsVisible() { var errors=0; AudioPlayback { throw SecurityException("denied") }.play("fixture") { errors++ }; assertEquals(1,errors) }
}
