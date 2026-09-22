package com.touliao.app.core.media
import org.junit.Assert.*
import org.junit.Test
class AudioPlaybackTest {
    private class Fake(val initFail: Boolean = false, val startFail: Boolean = false, val releaseFail: Boolean = false) : AudioPlayback.Device {
        var released = 0; var starts = 0
        lateinit var ready: () -> Unit; lateinit var done: () -> Unit; lateinit var failed: () -> Unit
        override fun prepare(url: String, ready: () -> Unit, done: () -> Unit, failed: () -> Unit) {
            this.ready=ready; this.done=done; this.failed=failed
            if (initFail) throw IllegalStateException("occupied")
        }
        override fun start() { if(startFail) throw IllegalStateException("error"); starts++ }
        override fun release() { released++; if(releaseFail) throw IllegalStateException("release failure") }
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
    @Test fun offlineFailureCanRetryWithNewDeviceAndLateFailureDoesNotAffectIt() {
        val first=Fake(); val retry=Fake(); var n=0; var errors=0
        val p=AudioPlayback { if(n++==0) first else retry }
        p.play("offline") { errors++ }; first.failed()
        assertEquals(1,errors); assertEquals(1,first.released)
        p.play("reconnected") { errors++ }; retry.ready(); first.failed(); first.done()
        assertEquals(1,retry.starts); assertEquals(0,retry.released); assertEquals(1,errors)
        retry.done(); assertEquals(1,retry.released)
    }
    @Test fun releaseFailureDoesNotHidePlaybackFailureOrPreventRetry() {
        val broken=Fake(releaseFail=true); val retry=Fake(); var n=0; var errors=0
        val p=AudioPlayback { if(n++==0) broken else retry }
        p.play("damaged") { errors++ }; broken.failed()
        assertEquals(1,errors); assertEquals(1,broken.released)
        p.play("valid") { fail(it) }; retry.ready(); assertEquals(1,retry.starts); p.stop()
    }
    @Test fun concurrentCompletionErrorAndStopReleaseExactlyOnce() {
        repeat(50) {
            val d=Fake(); val p=AudioPlayback { d }; val errors=java.util.concurrent.atomic.AtomicInteger()
            p.play("fixture") { errors.incrementAndGet() }
            val gate=java.util.concurrent.CountDownLatch(1)
            val threads=listOf({ d.failed() }, { d.done() }, { p.stop() }).map { action ->
                Thread { gate.await(); action() }.apply { start() }
            }
            gate.countDown(); threads.forEach { it.join() }
            assertEquals(1,d.released); assertTrue(errors.get()<=1)
        }
    }
}
