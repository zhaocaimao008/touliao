package com.touliao.app.core.call

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.core.di.AppScope
import com.touliao.app.core.push.NotificationHelper
import com.touliao.app.core.realtime.GroupCallInviteEvent
import com.touliao.app.core.realtime.SocketManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 一条待处理的群通话邀请（跨包契约 C7）。
 * [deadlineElapsed] 是 SystemClock.elapsedRealtime() 口径的截止时刻（不受改系统时间影响）。
 */
data class GroupCallInvite(
    val callId: String,
    val conversationId: String,
    val isVideo: Boolean,
    val fromId: String,
    val fromName: String,
    val deadlineElapsed: Long,
)

/** 群邀请有效期计算（纯函数，与 Web 一致：最多 60 秒）。 */
object GroupInviteExpiry {
    const val MAX_TTL_MS = 60_000L

    /**
     * 邀请剩余有效时间。[expiresAt] 为服务端给的截止时刻（毫秒时间戳），<= 0 表示旧版服务端没带，按 60 秒算；
     * 否则返回 (expiresAt - nowWallMs) 限制在 0..60 秒之间的结果（本机时钟偏差最多被截到 60 秒）。
     */
    fun remainingMs(expiresAt: Long, nowWallMs: Long): Long {
        if (expiresAt <= 0L) return MAX_TTL_MS
        return (expiresAt - nowWallMs).coerceIn(0L, MAX_TTL_MS)
    }
}

/**
 * 群通话邀请协调器（CALL-11）：应用级单例，在 TouliaoApp.onCreate（主进程）里 [start]。
 * - 来源：socket 的 group_call:invite，以及推送通路（FCM / 个推透传 / 个推厂商通道点击，经 [onPushInvite]），
 *   两路共用下面的过滤、去重、过期和横幅/通知；
 * - 过滤：空 id、发起人是自己（本账号其他设备发起）、已过期、本机正在 1v1 或群通话中；
 * - 去重（按 callId）：与当前邀请同一 callId，或最近已清掉过（加入、忽略、结束、过期、忙线清除、身份清理）、
 *   本机进过的群通话 callId 一律忽略：推送与 socket 重复到达只出现一次，迟到的那份也不会把已处理的邀请复活；
 * - 写入 [invite]，到截止时间自动清掉；
 * - MainActivity 可见时短振一下（由 CallOverlay 显示横幅），不可见时发带"加入 / 忽略"的系统通知，
 *   拿到群名后静默更新一次；
 * - 收到同一 callId 的 group_call:ended、自己进入任一通话、加入或忽略、到期、身份清理时，清掉邀请并撤掉通知；
 * - MainActivity 回到前台时撤掉通知，改由横幅显示。
 * 构造函数里不做任何事；依赖都用 dagger.Lazy，在 start() 启动的协程里才取用。
 */
@Singleton
class GroupCallInviteCoordinator @Inject constructor(
    @ApplicationContext private val context: Context,
    private val socketManager: dagger.Lazy<SocketManager>,
    private val callManager: dagger.Lazy<CallManager>,
    private val groupCallManager: dagger.Lazy<GroupCallManager>,
    private val sessionManager: dagger.Lazy<SessionManager>,
    private val roster: dagger.Lazy<GroupCallRoster>,
    private val notificationHelper: NotificationHelper,
    @AppScope private val scope: CoroutineScope,
) {
    private val started = AtomicBoolean(false)

    private val _invite = MutableStateFlow<GroupCallInvite?>(null)
    /** 当前待处理的群邀请；null 表示没有。 */
    val invite: StateFlow<GroupCallInvite?> = _invite.asStateFlow()

    // 保护 _invite 的读改写、过期 Job 引用和邀请通知的发/撤顺序（避免撤掉之后又被旧流程发出来）
    private val lock = Any()
    private var expiryJob: Job? = null
    // 最近清掉过的邀请 callId（见 clear）与本机进过的群通话 callId（见 start 的 4b）：迟到的推送 / socket 重发不得复活已处理的邀请
    private val handledCallIds = RecentIds(32)

    /** 启动监听（幂等）。 */
    fun start() {
        if (!started.compareAndSet(false, true)) return
        scope.launch {
            // (1) 身份清理：清掉当前邀请并撤掉它的通知
            sessionManager.get().onIdentityCleanup { clearCurrent() }
            // (2) 收到邀请
            launch { socketManager.get().groupCallInviteEvents.collect { onInvite(it) } }
            // (3) 发起方结束 / 服务端结束了这通群通话
            launch { socketManager.get().groupCallEndedEvents.collect { clear(it.callId) } }
            // (4) 自己进入任一通话：清掉邀请
            launch {
                combine(callManager.get().state, groupCallManager.get().state) { c, g ->
                    (c.stage != CallStage.IDLE && c.stage != CallStage.ENDED) || CallUiRules.isGroupActive(g.stage)
                }.distinctUntilChanged().collect { busy -> if (busy) clearCurrent() }
            }
            // (4b) 进过的群通话（含未经邀请、从会话里直接加入或自己发起的）记为已处理：离开后迟到的推送
            //      不会再为这通弹邀请（socket 只在发起时发一次邀请，两路行为一致）
            launch {
                groupCallManager.get().state.collect { g ->
                    if (CallUiRules.isGroupActive(g.stage) && g.callId.isNotEmpty()) {
                        handledCallIds.add(g.callId)
                    }
                }
            }
            // (5) MainActivity 回到前台：撤掉通知，改由横幅显示
            launch {
                CallUiPresence.mainUiStarted.collect { v ->
                    if (v) synchronized(lock) { _invite.value?.let { cancelNotification(it.callId) } }
                }
            }
        }
    }

    /**
     * 从横幅加入（主线程调用）。返回 null 表示已发起加入；非 null 是给用户看的提示。
     */
    fun join(invite: GroupCallInvite): String? {
        if (SystemClock.elapsedRealtime() >= invite.deadlineElapsed) {
            clear(invite.callId)
            return "群通话邀请已过期"
        }
        if (isBusy()) return "正在通话中，无法加入"
        groupCallManager.get().join(invite.callId, invite.conversationId, invite.isVideo)
        clear(invite.callId)
        return null
    }

    /**
     * 从邀请通知的"加入"进入（CallActivity 处理 GROUP_CALL_JOIN 时调用，主线程）。
     * [deadlineWallMs] 按本机 System.currentTimeMillis() 计。返回值语义同 [join]。
     */
    fun joinFromIntent(callId: String, conversationId: String, isVideo: Boolean, deadlineWallMs: Long): String? {
        val current = _invite.value
        if (current != null && callId.isNotEmpty() && current.callId == callId) return join(current)
        if (callId.isEmpty() || conversationId.isEmpty() || System.currentTimeMillis() >= deadlineWallMs) {
            clear(callId)
            return "群通话邀请已过期"
        }
        if (isBusy()) return "正在通话中，无法加入"
        groupCallManager.get().join(callId, conversationId, isVideo)
        clear(callId)
        return null
    }

    /** 忽略邀请（横幅"忽略"或通知"忽略"）。 */
    fun dismiss(callId: String) {
        clear(callId)
    }

    /**
     * 推送通路（FCM / 个推透传 / 厂商通道点击）的群邀请：与 socket 共用过滤、去重、过期、横幅或通知；任意线程可调用。
     * 收件人由调用方校验。[quiet]=true（用户点厂商通道通知拉起 MainActivity）时不振动、不另发通知，只写入邀请，由横幅显示。
     */
    fun onPushInvite(e: GroupCallInviteEvent, groupName: String, quiet: Boolean = false) = onInvite(e, groupName, quiet)

    /**
     * [knownGroupName] 非空（推送带了群名）时直接带群名发通知，不再拉取群名；
     * [quiet] 见 [onPushInvite]。
     */
    private fun onInvite(e: GroupCallInviteEvent, knownGroupName: String = "", quiet: Boolean = false) {
        if (e.callId.isEmpty() || e.conversationId.isEmpty()) return
        // 自己另一台设备发起的群通话：服务端用 socket.to(room) 发出，本账号其他设备也会收到
        if (e.from == sessionManager.get().currentUser?.id) return
        val remaining = GroupInviteExpiry.remainingMs(e.expiresAt, System.currentTimeMillis())
        if (remaining <= 0L) return
        val inv = GroupCallInvite(
            e.callId, e.conversationId, e.type == "video", e.from, e.fromName,
            SystemClock.elapsedRealtime() + remaining,
        )
        val foreground = synchronized(lock) {
            // 忙线判断放在锁内：与 (4) 的 clearCurrent 互斥，避免"刚进通话又写入邀请"
            if (isBusy()) return
            // 推送与 socket 重复到达只出现一次；已处理的邀请不被迟到的那份复活
            if (inv.callId in handledCallIds || _invite.value?.callId == inv.callId) return
            val old = _invite.value
            if (old != null && old.callId != inv.callId) cancelNotification(old.callId)
            _invite.value = inv
            expiryJob?.cancel()
            expiryJob = scope.launch {
                delay(remaining)
                clear(inv.callId)
            }
            val fg = CallUiPresence.mainUiStarted.value
            if (!fg && !quiet) postNotification(inv, knownGroupName, remaining)
            fg
        }
        // 厂商通道点击拉起：用户已经在看了，不振动、不另发通知，由横幅显示
        if (quiet) return
        if (foreground) {
            // MainActivity 可见：横幅由 CallOverlay 显示，这里只短振一下
            vibrateShort()
        } else if (knownGroupName.isEmpty()) {
            // 先发不带群名的通知，取到群名后静默更新一次（推送已带群名时不再拉取）
            scope.launch {
                val name = runCatching { roster.get().groupName(inv.conversationId) }.getOrDefault("")
                if (name.isEmpty()) return@launch
                synchronized(lock) {
                    if (_invite.value != inv || CallUiPresence.mainUiStarted.value) return@launch
                    val left = inv.deadlineElapsed - SystemClock.elapsedRealtime()
                    if (left > 0L) postNotification(inv, name, left)
                }
            }
        }
    }

    /**
     * 清掉指定邀请：是当前邀请就置空并取消过期 Job；无论是否当前，都撤掉该 callId 的通知。
     * 同时记下 callId（加入、忽略、结束、过期、忙线清除、身份清理都经过这里），迟到的推送因此不会复活这些邀请。
     */
    private fun clear(callId: String) {
        if (callId.isEmpty()) return
        synchronized(lock) {
            handledCallIds.add(callId)
            if (_invite.value?.callId == callId) {
                _invite.value = null
                expiryJob?.cancel()
                expiryJob = null
            }
            cancelNotification(callId)
        }
    }

    private fun clearCurrent() {
        val id = synchronized(lock) { _invite.value?.callId } ?: return
        clear(id)
    }

    /** 1v1 不是 IDLE/ENDED（含响铃），或群通话正在进行。 */
    private fun isBusy(): Boolean {
        val c = callManager.get().state.value.stage
        return (c != CallStage.IDLE && c != CallStage.ENDED) || CallUiRules.isGroupActive(groupCallManager.get().state.value.stage)
    }

    // 通知调用一律吞异常：这些都跑在 AppScope 的收集协程里，异常外抛会让整组监听退出
    private fun postNotification(inv: GroupCallInvite, groupName: String, remainingMs: Long) {
        runCatching { notificationHelper.showGroupCallInvite(inv, groupName, remainingMs) }
    }

    private fun cancelNotification(callId: String) {
        runCatching { notificationHelper.cancelGroupCallInvite(callId) }
    }

    /** 前台收到邀请时短振一次（铃声模式为静音时不振）。 */
    private fun vibrateShort() {
        runCatching {
            val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            if (am != null && am.ringerMode == AudioManager.RINGER_MODE_SILENT) return
            val vib = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            } ?: return
            val pattern = longArrayOf(0L, 120L, 80L, 120L)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vib.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                vib.vibrate(pattern, -1)
            }
        }
    }
}
