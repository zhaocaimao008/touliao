package com.touliao.app.core.auth
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.HttpException
import retrofit2.Response
import kotlinx.coroutines.async
class RestoreFailureTest {
    @Test fun only401InvalidatesCredentials() {
        assertEquals(RestoreFailure.EXPIRED, RestoreFailure.from(HttpException(Response.error<Any>(401,"{}".toResponseBody()))))
        assertEquals(RestoreFailure.FORBIDDEN, RestoreFailure.from(HttpException(Response.error<Any>(403,"{}".toResponseBody()))))
        for(code in listOf(429,500,502,503)) assertEquals(RestoreFailure.SERVER, RestoreFailure.from(HttpException(Response.error<Any>(code,"{}".toResponseBody()))))
    }
    @Test fun offlineTimeoutAndUnknownFailureRemainRetryable() {
        assertEquals(RestoreFailure.TIMEOUT,RestoreFailure.from(SocketTimeoutException()))
        assertEquals(RestoreFailure.OFFLINE,RestoreFailure.from(IOException()))
        assertEquals(RestoreFailure.SERVER,RestoreFailure.from(IllegalStateException()))
    }
    @Test fun offlineTimeoutServerRetryThenRecover() = kotlinx.coroutines.runBlocking {
        var attempt=0; var accepted=""; val errors=mutableListOf<RestoreFailure>(); val waits=mutableListOf<Long>()
        restoreWithRetry(isCurrent={true}, load={
            when(attempt++) { 0 -> throw IOException(); 1 -> throw SocketTimeoutException(); 2 -> throw HttpException(Response.error<Any>(503,"{}".toResponseBody())); else -> "account-A" }
        }, accept={accepted=it}, failure={errors.add(it)}, wait={waits.add(it)})
        assertEquals("account-A",accepted); assertEquals(listOf(1000L,2000L,4000L),waits)
        assertEquals(listOf(RestoreFailure.OFFLINE,RestoreFailure.TIMEOUT,RestoreFailure.SERVER),errors)
    }
    @Test fun concurrentSwitchDropsStaleSuccessAndFailure() = kotlinx.coroutines.runBlocking {
        for(fails in listOf(false,true)) {
            var current=true; var accepted=0; var failed=0
            val gate=kotlinx.coroutines.CompletableDeferred<Unit>()
            val job=async(start=kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
                restoreWithRetry(isCurrent={current}, load={gate.await(); if(fails) throw IOException(); "A"}, accept={accepted++}, failure={failed++})
            }
            current=false; gate.complete(Unit); job.await()
            assertEquals(0,accepted); assertEquals(0,failed)
        }
    }
    @Test fun expiryStopsAndCancellationNeverBecomesLogout() = kotlinx.coroutines.runBlocking {
        var errors=0
        restoreWithRetry(isCurrent={true}, load={throw HttpException(Response.error<Any>(401,"{}".toResponseBody()))}, accept={fail()}, failure={errors++}, wait={fail("401 retried")})
        assertEquals(1,errors)
        try { restoreWithRetry(isCurrent={true}, load={throw kotlinx.coroutines.CancellationException()}, accept={fail()}, failure={fail("cancel logged out")}); fail() } catch(_: kotlinx.coroutines.CancellationException) {}
    }

    @Test fun forbiddenIsTerminalAndStaleForbiddenCannotAffectNewAccount() = kotlinx.coroutines.runBlocking {
        var attempts=0; var errors=0; var current=true
        restoreWithRetry(isCurrent={current}, load={attempts++; throw HttpException(Response.error<Any>(403,"{}".toResponseBody()))},
            accept={fail()}, failure={ assertEquals(RestoreFailure.FORBIDDEN,it); errors++ }, wait={fail("403 retried")})
        assertEquals(1, attempts); assertEquals(1, errors)
        restoreWithRetry(isCurrent={current}, load={current=false; throw HttpException(Response.error<Any>(403,"{}".toResponseBody()))},
            accept={fail()}, failure={fail("stale 403 published")}, wait={fail()})
    }
    @Test fun retriesAreCappedAndAccountSwitchDuringBackoffStopsNetwork() = kotlinx.coroutines.runBlocking {
        var current=true; var attempts=0; val waits=mutableListOf<Long>()
        restoreWithRetry(isCurrent={current}, load={attempts++; throw IOException()}, accept={fail()}, failure={},
            wait={ waits.add(it); if(waits.size==8) current=false })
        assertEquals(listOf(1000L,2000L,4000L,8000L,16000L,30000L,30000L,30000L), waits)
        assertEquals(8, attempts)
    }
}
