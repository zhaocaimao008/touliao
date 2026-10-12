package com.touliao.app.core.call

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** WebRTC 工厂懒初始化 / ICE 选择 / 通话质量上报载荷（2026-10-12）。 */
class CallPerfHelpersTest {

    // ── OnceInitializer（WebRtcFactoryHolder 的核心）──
    @Test fun factoryNotCreatedUntilFirstUse() {
        val created = AtomicInteger()
        val holder = OnceInitializer(Dispatchers.Default) { created.incrementAndGet(); Any() }
        assertNull(holder.getOrNull())
        assertEquals(0, created.get())
    }

    @Test fun concurrentAwaitCreatesExactlyOnce() = runBlocking {
        val created = AtomicInteger()
        val holder = OnceInitializer(Dispatchers.Default) { Thread.sleep(20); created.incrementAndGet(); Any() }
        val results = (1..16).map { async(Dispatchers.Default) { holder.await() } }.awaitAll()
        assertEquals(1, created.get())
        results.forEach { assertSame(results[0], it) }
        assertSame(results[0], holder.getOrNull())
    }

    @Test fun failedInitIsRetriedNotCached() = runBlocking {
        var attempt = 0
        val holder = OnceInitializer(Dispatchers.Default) { if (attempt++ == 0) error("so load failed") else "ok" }
        assertTrue(runCatching { holder.await() }.isFailure)
        assertNull(holder.getOrNull())
        assertEquals("ok", holder.await())
    }

    @Test fun linkageErrorIsCachedAndNotRetried() = runBlocking {
        val attempts = AtomicInteger()
        val holder = OnceInitializer<Any>(Dispatchers.Default) {
            attempts.incrementAndGet(); throw UnsatisfiedLinkError("libjingle_peerconnection_so")
        }
        repeat(3) { assertTrue(runCatching { holder.await() }.exceptionOrNull() is UnsatisfiedLinkError) }
        assertEquals(1, attempts.get())
        assertNull(holder.getOrNull())
    }

    // ── 共享 ICE 选择逻辑 ──
    @Test fun iceSelectionPrefersFreshThenUnexpiredCacheThenFallback() {
        val fb = listOf("stun-fallback")
        assertEquals(listOf("fresh") to IceSource.FRESH, selectIceServers(listOf("fresh"), listOf("old"), 100, 50, fb))
        assertEquals(listOf("old") to IceSource.CACHED, selectIceServers(null, listOf("old"), 100, 50, fb))
        // 过期缓存不再沿用（群通话旧逻辑会一直用过期 TURN 凭证）
        assertEquals(fb to IceSource.FALLBACK, selectIceServers(null, listOf("old"), 100, 100, fb))
        assertEquals(fb to IceSource.FALLBACK, selectIceServers(emptyList(), null, 0, 0, fb))
    }

    // ── stats 解析 ──
    private fun stats(vararg e: StatEntry) = e.toList()

    @Test fun parsesSelectedPairViaTransportAndCandidates() {
        val s = parseStats(stats(
            StatEntry("T1", "transport", mapOf("selectedCandidatePairId" to "CP2")),
            StatEntry("CP1", "candidate-pair", mapOf("state" to "succeeded", "nominated" to true,
                "localCandidateId" to "L1", "remoteCandidateId" to "R1", "currentRoundTripTime" to 0.5)),
            StatEntry("CP2", "candidate-pair", mapOf("state" to "succeeded", "nominated" to true,
                "localCandidateId" to "L2", "remoteCandidateId" to "R2", "currentRoundTripTime" to 0.08)),
            StatEntry("L1", "local-candidate", mapOf("candidateType" to "host", "protocol" to "udp")),
            StatEntry("L2", "local-candidate", mapOf("candidateType" to "relay", "protocol" to "udp", "relayProtocol" to "tls")),
            StatEntry("R2", "remote-candidate", mapOf("candidateType" to "srflx", "protocol" to "udp")),
            // packetsLost 是 Integer、packetsReceived 是 Long（WebRTC Android 实际类型）
            StatEntry("IA", "inbound-rtp", mapOf("kind" to "audio", "packetsLost" to 5, "packetsReceived" to 95L)),
            StatEntry("IV", "inbound-rtp", mapOf("kind" to "video", "packetsLost" to 50, "packetsReceived" to 50L)),
        ))
        assertEquals("relay", s.localCandidateType)
        assertEquals("srflx", s.remoteCandidateType)
        assertEquals("udp", s.protocol)
        assertEquals("tls", s.relayProtocol)
        assertEquals(80.0, s.rttMs!!, 0.001)
        assertEquals(5L, s.audioPacketsLost)
        assertEquals(0.05, s.lossRate(), 0.0001)
    }

    @Test fun fallsBackToNominatedSucceededPairAndRejectsUnknownValues() {
        val s = parseStats(stats(
            StatEntry("CP1", "candidate-pair", mapOf("state" to "in-progress", "nominated" to false, "localCandidateId" to "L0")),
            StatEntry("CP2", "candidate-pair", mapOf("state" to "succeeded", "nominated" to true,
                "localCandidateId" to "L1", "remoteCandidateId" to "R1")),
            StatEntry("L1", "local-candidate", mapOf("candidateType" to "weird", "protocol" to "sctp")),
            StatEntry("R1", "remote-candidate", mapOf("candidateType" to "prflx")),
        ))
        assertNull(s.localCandidateType)
        assertNull(s.protocol)
        assertEquals("prflx", s.remoteCandidateType)
        assertNull(s.rttMs)
    }

    @Test fun accumulatorAveragesRttAndSumsLossPerPeer() {
        val acc = CallQualityAccumulator()
        acc.ingest("a", StatsSample(localCandidateType = "host", rttMs = 100.0, audioPacketsLost = 1, audioPacketsReceived = 99))
        acc.ingest("a", StatsSample(rttMs = 300.0, audioPacketsLost = 2, audioPacketsReceived = 198))   // 累计值，覆盖
        acc.ingest("b", StatsSample(audioPacketsLost = 8, audioPacketsReceived = 92))
        val sum = acc.snapshot()
        assertEquals(200.0, sum.rttMsAvg!!, 0.001)
        assertEquals(10 * 100.0 / 300, sum.packetLossPct!!, 0.001)
        assertEquals("host", sum.localCandidateType)   // 无候选信息的样本不覆盖已知选中对
        acc.reset()
        assertNull(acc.snapshot().rttMsAvg)
        assertNull(acc.snapshot().packetLossPct)
    }

    // ── 上报载荷 ──
    private fun input(connectedAt: Long, stats: CallQualityAccumulator.Summary = CallQualityAccumulator().snapshot()) = CallReportInput(
        isCaller = true, isVideo = false, group = false,
        setupStartAt = 1_000, connectedAt = connectedAt, endedAt = 65_400,
        endReason = "hangup", iceRestarts = 2, stats = stats, appVersion = "8.1.44",
    )

    @Test fun reportPayloadMatchesBackendContract() {
        val acc = CallQualityAccumulator().apply {
            ingest("p", StatsSample("relay", "srflx", "udp", "tcp", rttMs = 123.456, audioPacketsLost = 1, audioPacketsReceived = 299))
        }
        val o = buildCallReportJson(input(connectedAt = 3_500, stats = acc.snapshot()))
        assertEquals("caller", (o["role"] as JsonPrimitive).content)
        assertEquals("audio", (o["callType"] as JsonPrimitive).content)
        assertFalse((o["group"] as JsonPrimitive).boolean)
        assertTrue((o["connected"] as JsonPrimitive).boolean)
        assertEquals(2_500L, (o["setupMs"] as JsonPrimitive).long)
        assertEquals(61L, (o["durationSec"] as JsonPrimitive).long)
        assertEquals("hangup", (o["endReason"] as JsonPrimitive).content)
        assertEquals(2L, (o["iceRestarts"] as JsonPrimitive).long)
        assertEquals("relay", (o["localCandidateType"] as JsonPrimitive).content)
        assertEquals("tcp", (o["relayProtocol"] as JsonPrimitive).content)
        assertEquals(123.5, (o["rttMsAvg"] as JsonPrimitive).double, 0.0001)
        assertEquals("android", (o["platform"] as JsonPrimitive).content)
        assertEquals("8.1.44", (o["appVersion"] as JsonPrimitive).content)
        assertEquals(16, o.size)
    }

    @Test fun unconnectedCallEncodesExplicitNulls() {
        val o = buildCallReportJson(input(connectedAt = 0))
        assertFalse((o["connected"] as JsonPrimitive).boolean)
        assertEquals(JsonNull, o["setupMs"])
        assertEquals(0L, (o["durationSec"] as JsonPrimitive).long)
        for (k in listOf("localCandidateType", "remoteCandidateType", "protocol", "relayProtocol", "rttMsAvg", "packetLossPct")) {
            assertEquals(k, JsonNull, o[k])
        }
    }
}
