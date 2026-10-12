package com.touliao.app.core.call

import android.util.Log
import com.touliao.app.core.di.AppScope
import com.touliao.app.data.api.CallReportApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.webrtc.RTCStatsReport
import javax.inject.Inject
import javax.inject.Singleton

// ── 通话质量上报（2026-10-12）：POST /api/calls/:callId/report，挂断时 fire-and-forget ──
// 数据来自通话中已有的 getStats 采样（不在挂断时再取 stats，绝不拖慢挂断）。

/** 与 WebRTC 解耦的单条 stats（便于单测）：id / type / members。 */
internal data class StatEntry(val id: String, val type: String, val members: Map<String, Any?>)

/** 一次 getStats 的摘要：选中候选对 + RTT + 入站音频丢包累计值。 */
internal data class StatsSample(
    val localCandidateType: String? = null,
    val remoteCandidateType: String? = null,
    val protocol: String? = null,
    val relayProtocol: String? = null,
    val rttMs: Double? = null,
    val audioPacketsLost: Long = 0,
    val audioPacketsReceived: Long = 0,
)

private val CANDIDATE_TYPES = setOf("host", "srflx", "prflx", "relay")
private val PROTOCOLS = setOf("udp", "tcp")
private val RELAY_PROTOCOLS = setOf("udp", "tcp", "tls")

private fun Any?.str(): String? = (this as? String)?.lowercase()
private fun Any?.num(): Number? = this as? Number

/**
 * 解析选中候选对：优先 transport.selectedCandidatePairId，否则取 state=succeeded 且 nominated 的 candidate-pair。
 * 再按 localCandidateId/remoteCandidateId 查 local-candidate/remote-candidate 的 candidateType/protocol/relayProtocol。
 */
internal fun parseStats(entries: Collection<StatEntry>): StatsSample {
    val byId = entries.associateBy { it.id }
    val selectedId = entries.firstOrNull { it.type == "transport" }?.members?.get("selectedCandidatePairId") as? String
    val pair = selectedId?.let { byId[it] }?.takeIf { it.type == "candidate-pair" }
        ?: entries.firstOrNull { it.type == "candidate-pair" && it.members["state"] == "succeeded" && it.members["nominated"] == true }
    val local = pair?.members?.get("localCandidateId")?.let { byId[it as? String ?: ""] }
    val remote = pair?.members?.get("remoteCandidateId")?.let { byId[it as? String ?: ""] }
    var lost = 0L; var received = 0L
    for (e in entries) {
        if (e.type == "inbound-rtp" && (e.members["kind"] == "audio" || e.members["mediaType"] == "audio")) {
            // packetsLost 是 int32（Java Integer）、packetsReceived 是 uint32（Long）：统一按 Number 读，
            // 此前按 Long 强转导致 packetsLost 永远读成 0。
            lost += e.members["packetsLost"].num()?.toLong()?.coerceAtLeast(0) ?: 0L
            received += e.members["packetsReceived"].num()?.toLong() ?: 0L
        }
    }
    return StatsSample(
        localCandidateType = local?.members?.get("candidateType").str()?.takeIf { it in CANDIDATE_TYPES },
        remoteCandidateType = remote?.members?.get("candidateType").str()?.takeIf { it in CANDIDATE_TYPES },
        protocol = local?.members?.get("protocol").str()?.takeIf { it in PROTOCOLS },
        relayProtocol = local?.members?.get("relayProtocol").str()?.takeIf { it in RELAY_PROTOCOLS },
        rttMs = pair?.members?.get("currentRoundTripTime").num()?.toDouble()?.let { it * 1000 },
        audioPacketsLost = lost,
        audioPacketsReceived = received,
    )
}

internal fun RTCStatsReport.toEntries(): List<StatEntry> =
    statsMap.values.map { StatEntry(it.id, it.type, it.members) }

/** 由一次采样计算丢包率（0..1）。 */
internal fun StatsSample.lossRate(): Double {
    val total = audioPacketsLost + audioPacketsReceived
    return if (total > 0) audioPacketsLost.toDouble() / total else 0.0
}

/**
 * 通话期间的统计累加器（线程安全：getStats 回调在 WebRTC 线程）。
 * key 区分不同 PeerConnection（群通话每个 peer 一条；1v1 固定一个 key），丢包按各 key 最新累计值求和。
 */
internal class CallQualityAccumulator {
    private var rttSum = 0.0
    private var rttCount = 0
    private val lossByKey = HashMap<String, Pair<Long, Long>>()
    private var pair: StatsSample? = null

    @Synchronized fun reset() { rttSum = 0.0; rttCount = 0; lossByKey.clear(); pair = null }

    @Synchronized fun ingest(key: String, s: StatsSample) {
        s.rttMs?.let { rttSum += it; rttCount++ }
        if (s.audioPacketsLost + s.audioPacketsReceived > 0) lossByKey[key] = s.audioPacketsLost to s.audioPacketsReceived
        if (s.localCandidateType != null || s.remoteCandidateType != null) pair = s
    }

    @Synchronized fun snapshot(): Summary {
        val lost = lossByKey.values.sumOf { it.first }
        val total = lossByKey.values.sumOf { it.first + it.second }
        return Summary(
            rttMsAvg = if (rttCount > 0) rttSum / rttCount else null,
            packetLossPct = if (total > 0) lost * 100.0 / total else null,
            localCandidateType = pair?.localCandidateType,
            remoteCandidateType = pair?.remoteCandidateType,
            protocol = pair?.protocol,
            relayProtocol = pair?.relayProtocol,
        )
    }

    data class Summary(
        val rttMsAvg: Double?,
        val packetLossPct: Double?,
        val localCandidateType: String?,
        val remoteCandidateType: String?,
        val protocol: String?,
        val relayProtocol: String?,
    )
}

/** 上报载荷（字段与后端契约一一对应；null 显式编码为 JSON null）。 */
internal data class CallReportInput(
    val isCaller: Boolean,
    val isVideo: Boolean,
    val group: Boolean,
    val setupStartAt: Long,   // 拨出/接听/发起或加入群通话时刻（elapsedRealtime，0=未知）
    val connectedAt: Long,    // 首次媒体接通时刻（elapsedRealtime，0=未接通）
    val endedAt: Long,
    val endReason: String,
    val iceRestarts: Int,
    val stats: CallQualityAccumulator.Summary,
    val appVersion: String,
)

internal fun buildCallReportJson(i: CallReportInput): JsonObject {
    val connected = i.connectedAt > 0
    val setupMs = if (connected && i.setupStartAt > 0 && i.connectedAt >= i.setupStartAt) i.connectedAt - i.setupStartAt else null
    val durationSec = if (connected && i.endedAt >= i.connectedAt) (i.endedAt - i.connectedAt) / 1000 else 0L
    fun n(v: Number?) = v?.let { JsonPrimitive(it) } ?: JsonNull
    fun s(v: String?) = v?.let { JsonPrimitive(it) } ?: JsonNull
    fun round1(v: Double?) = v?.let { Math.round(it * 10) / 10.0 }
    return buildJsonObject {
        put("role", JsonPrimitive(if (i.isCaller) "caller" else "callee"))
        put("callType", JsonPrimitive(if (i.isVideo) "video" else "audio"))
        put("group", JsonPrimitive(i.group))
        put("connected", JsonPrimitive(connected))
        put("setupMs", n(setupMs))
        put("durationSec", JsonPrimitive(durationSec))
        put("endReason", JsonPrimitive(i.endReason.ifBlank { "ended" }.take(64)))
        put("iceRestarts", JsonPrimitive(i.iceRestarts.coerceAtLeast(0)))
        put("localCandidateType", s(i.stats.localCandidateType))
        put("remoteCandidateType", s(i.stats.remoteCandidateType))
        put("protocol", s(i.stats.protocol))
        put("relayProtocol", s(i.stats.relayProtocol))
        put("rttMsAvg", n(round1(i.stats.rttMsAvg)))
        put("packetLossPct", n(round1(i.stats.packetLossPct)))
        put("platform", JsonPrimitive("android"))
        put("appVersion", JsonPrimitive(i.appVersion))
    }
}

/**
 * 通话质量上报：fire-and-forget，任何失败（含旧后端 404）静默忽略；
 * 只在 AppScope 的 IO 协程里发，调用方（cleanup）同步返回，绝不拖慢挂断。
 */
@Singleton
class CallQualityReporter @Inject constructor(
    private val api: CallReportApi,
    @AppScope private val scope: CoroutineScope,
) {
    internal fun send(callId: String, input: CallReportInput) {
        if (callId.isBlank()) return
        val body = runCatching { buildCallReportJson(input).toString() }.getOrNull() ?: return
        scope.launch(Dispatchers.IO) {
            runCatching {
                val resp = api.report(callId, body.toRequestBody("application/json".toMediaType()))
                resp.body()?.close(); resp.errorBody()?.close()
            }.onFailure { Log.d("CallQualityReporter", "call report skipped: ${it.message}") }
        }
    }
}
