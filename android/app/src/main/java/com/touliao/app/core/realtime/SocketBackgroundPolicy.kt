package com.touliao.app.core.realtime

import android.util.Log
import com.touliao.app.core.auth.AuthState
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.call.GroupCallManager
import com.touliao.app.core.call.GroupCallStage
import com.touliao.app.core.di.AppScope
import com.touliao.app.core.util.AppForeground
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** 通话阶段是否算「通话中」（含响铃/呼出/接通中）：这些阶段后台也必须保持信令连接。 */
internal fun isCallActive(stage: CallStage) = stage != CallStage.IDLE && stage != CallStage.ENDED
internal fun isGroupCallActive(stage: GroupCallStage) = stage != GroupCallStage.IDLE && stage != GroupCallStage.ENDED

/**
 * 后台省电（2026-10-12）：此前 socket 进程活着就永不断开，断网后 1s→10s 无限重连，后台持续耗电。
 * 现在：App 退到后台满 [BACKGROUND_GRACE_MS] 且没有进行中的通话 → 主动断开；回到前台立即重连
 * （ChatViewModel / 会话列表监听重连做增量补齐）。后台期间的新消息与来电由 FCM / 个推推送覆盖
 * （后端判定离线即推送，来电点通知拉起 MainActivity 时会主动 connect）。
 * 前后台信号来自 MessageNotificationBridge 已有的 Activity 计数（项目未引入 lifecycle-process）。
 */
@Singleton
class SocketBackgroundPolicy @Inject constructor(
    private val socketManager: SocketManager,
    private val sessionManager: dagger.Lazy<SessionManager>,
    private val callManager: dagger.Lazy<CallManager>,
    private val groupCallManager: dagger.Lazy<GroupCallManager>,
    @AppScope private val scope: CoroutineScope,
) {
    @Volatile private var suspendedForBackground = false
    @Volatile private var started = false
    @Volatile private var callPushJob: Job? = null

    /**
     * 后台收到来电推送（FCM / 个推）：若实时连接已因后台省电断开，临时重连，让 call:end
     * （主叫取消、本账号其他设备接听/拒绝）能送达并收起来电通知；通话收尾后若仍在后台，
     * 等 [BACKGROUND_GRACE_MS] 再断开。回到前台由 [start] 的前台分支接管。
     */
    fun onCallPush() {
        if (!suspendedForBackground) return
        if (sessionManager.get().state.value !is AuthState.Authenticated) return
        if (!socketManager.hasSession()) {
            Log.i(TAG, "后台来电推送：临时恢复实时连接以接收通话状态")
            socketManager.connect()
        }
        callPushJob?.cancel()
        callPushJob = scope.launch {
            delay(BACKGROUND_GRACE_MS)
            combine(callManager.get().state, groupCallManager.get().state) { c, g ->
                isCallActive(c.stage) || isGroupCallActive(g.stage)
            }.first { active -> !active }
            if (!AppForeground.isForeground && suspendedForBackground && socketManager.disconnectForBackground()) {
                Log.i(TAG, "来电推送后的临时连接已无通话：再次断开")
            }
        }
    }

    fun start() {
        if (started) return
        started = true
        scope.launch {
            AppForeground.state.collectLatest { foreground ->
                if (foreground) {
                    callPushJob?.cancel()
                    callPushJob = null
                    if (suspendedForBackground) {
                        suspendedForBackground = false
                        // 后台期间被登出/拒绝访问则不重连（connect 自身也会校验 token）；
                        // 来电通知拉起时 MainActivity 可能已先 connect()，正在握手的连接不要拆掉重建
                        if (sessionManager.get().state.value is AuthState.Authenticated && !socketManager.hasSession()) {
                            Log.i(TAG, "回到前台：恢复实时连接")
                            socketManager.connect()
                        }
                    }
                    return@collectLatest
                }
                delay(BACKGROUND_GRACE_MS)
                // 通话进行中（含响铃）不断开：等通话结束后再断（collectLatest 回前台会取消这里的等待）
                combine(callManager.get().state, groupCallManager.get().state) { c, g ->
                    isCallActive(c.stage) || isGroupCallActive(g.stage)
                }.first { active -> !active }
                if (socketManager.disconnectForBackground()) {
                    suspendedForBackground = true
                    Log.i(TAG, "后台 ${BACKGROUND_GRACE_MS / 1000}s 无通话：断开实时连接省电，消息/来电走推送")
                }
            }
        }
    }

    private companion object {
        const val TAG = "SocketBgPolicy"
        const val BACKGROUND_GRACE_MS = 60_000L
    }
}
