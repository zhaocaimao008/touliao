package com.touliao.app.core.call

import android.util.Log
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.data.api.TurnApi
import org.webrtc.PeerConnection
import javax.inject.Inject
import javax.inject.Singleton

/** ICE 列表来源（日志/测试用）。 */
internal enum class IceSource { FRESH, CACHED, FALLBACK }

/**
 * 纯选择逻辑：新拉到的优先；拉取失败时用未过期缓存；否则 STUN 兜底。
 * 缓存过期即视为没有——此前群通话失败时一直沿用旧凭证，超过 TTL 后 coturn 拒绝认证，等于静默丢了 TURN。
 */
internal fun <T> selectIceServers(
    fresh: List<T>?,
    cached: List<T>?,
    cachedExpiresAt: Long,
    now: Long,
    fallback: List<T>,
): Pair<List<T>, IceSource> = when {
    !fresh.isNullOrEmpty() -> fresh to IceSource.FRESH
    !cached.isNullOrEmpty() && now < cachedExpiresAt -> cached to IceSource.CACHED
    else -> fallback to IceSource.FALLBACK
}

/**
 * 1v1 与群通话共用的 ICE（含时效 TURN 凭证）获取（2026-10-12 从 CallManager 抽出）。
 * 群通话此前是旧模式：失败沿用任意旧值、无 TTL、无自家 STUN 兜底、401 不重试。
 */
@Singleton
class IceServerProvider @Inject constructor(
    private val turnApi: TurnApi,
    private val sessionManager: SessionManager,
) {
    // STUN-only 兜底。自家 coturn（与 TURN 同机，3478 同时提供 STUN）放第一位：国内网络下 Google STUN 常不可达。
    private val fallbackIceServers: List<PeerConnection.IceServer> by lazy {
        listOf(
            PeerConnection.IceServer.builder("stun:$FALLBACK_STUN_HOST:3478").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        )
    }

    // 上次成功拉到的 ICE 及其过期时刻（elapsedRealtime）
    @Volatile private var cachedIce: List<PeerConnection.IceServer>? = null
    @Volatile private var cachedIceExpiresAt = 0L

    init {
        // TURN 用户名绑定 userId，换号/登出后旧凭证不可再用
        sessionManager.onIdentityCleanup { clearCache() }
    }

    fun clearCache() { cachedIce = null; cachedIceExpiresAt = 0L }

    /** 通话建立前调用：失败时用未过期缓存，否则兜底 STUN，从不抛异常、不阻断通话。 */
    suspend fun resolve(tag: String): List<PeerConnection.IceServer> {
        val fresh = try {
            fetch()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            Log.w(tag, "refreshIceServers failed", e)
            null
        }
        val (servers, source) = selectIceServers(fresh, cachedIce, cachedIceExpiresAt,
            android.os.SystemClock.elapsedRealtime(), fallbackIceServers)
        when (source) {
            IceSource.FRESH -> {}
            IceSource.CACHED -> Log.w(tag, "ICE: using cached TURN credentials (still within TTL)")
            IceSource.FALLBACK -> {
                cachedIce = null
                Log.w(tag, "ICE fallback: no valid TURN credentials, STUN-only ($FALLBACK_STUN_HOST:3478, then Google)")
            }
        }
        return servers
    }

    private suspend fun fetch(): List<PeerConnection.IceServer>? {
        val creds = try {
            turnApi.getCredentials()
        } catch (e: retrofit2.HttpException) {
            // 401：AuthInterceptor 会把「本次请求所用且仍为当前」的 token 作废并走登出。只有请求途中
            // token 已被替换（改密 applyNewToken / 切号）时本地仍有 token，这种情况用新 token 重试一次；
            // 否则重试必然再 401，直接抛出走兜底。
            if (e.code() != 401 || sessionManager.credentialSnapshot().token == null) throw e
            Log.w("IceServerProvider", "turn credentials 401 with a replaced token, retrying once")
            turnApi.getCredentials()
        }
        val servers = creds.iceServers.mapNotNull { dto ->
            if (dto.urls.isEmpty()) return@mapNotNull null
            PeerConnection.IceServer.builder(dto.urls).apply {
                dto.username?.let { setUsername(it) }
                dto.credential?.let { setPassword(it) }
            }.createIceServer()
        }
        if (servers.isEmpty()) return null
        // 预留 60s 余量：凭证在通话建立后还要撑过 ICE restart 的重新认证
        cachedIceExpiresAt = android.os.SystemClock.elapsedRealtime() + (creds.ttl - 60).coerceAtLeast(0) * 1000L
        cachedIce = servers
        return servers
    }

    private companion object {
        // TURN 服务器主机（backend-v2 TURN_URLS 同一主机），ICE 兜底时用其 3478 STUN
        const val FALLBACK_STUN_HOST = "touliao.cc"
    }
}

/**
 * 1v1 / 群通话共用的 RTCConfiguration（2026-10-12）：
 *  - GATHER_CONTINUALLY：网络切换（Wi-Fi↔4G）后持续收集新候选并 trickle 给对端，无需等整轮 restart；
 *  - iceCandidatePoolSize=2：提前预收集候选，缩短接通耗时。
 */
internal fun buildCallRtcConfig(iceServers: List<PeerConnection.IceServer>): PeerConnection.RTCConfiguration =
    PeerConnection.RTCConfiguration(iceServers).apply {
        sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        iceCandidatePoolSize = 2
    }
