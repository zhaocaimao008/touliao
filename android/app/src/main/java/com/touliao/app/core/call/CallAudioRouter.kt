package com.touliao.app.core.call

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log
import com.touliao.app.core.di.AppScope
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 通话音频路由/焦点（1v1 [CallManager] 与群通话 [GroupCallManager] 共用）。
 *
 * 2026-10-02 从 CallManager 抽出：此前群通话完全没有音频模式/焦点/路由——不切
 * MODE_IN_COMMUNICATION、没有扬声器开关，系统电话打进来也不静音。
 *
 * - [acquire]：切 MODE_IN_COMMUNICATION + 申请通话焦点 + 默认路由（有蓝牙 SCO 耳机优先蓝牙，
 *   否则视频→扬声器、语音→听筒）。幂等：已持有时只登记 owner，不重置用户已选的路由。
 * - [release]：最后一个 owner 释放时才真正放焦点/停 SCO/恢复 MODE_NORMAL。
 * - API 31+ 用 setCommunicationDevice/clearCommunicationDevice；以下保留 isSpeakerphoneOn/startBluetoothSco。
 * - 只有 TYPE_BLUETOOTH_SCO 算可用通话耳机（只连了 A2DP 的音箱/耳机不能走通话音频）。
 * - 焦点：系统电话→通知 owner 静音麦克风；短时丢失(含其他 VoIP 如微信通话)→等 GAIN 不抢；
 *   永久丢失(其他 App 放音乐/视频)→1s 后重新申请，失败指数退避，最多 [FOCUS_REACQUIRE_MAX] 次。
 *   GAIN/重新申请成功都重新切 mode 并按当前路由选择重放，不重置用户选择。
 *
 * 线程：焦点/广播/设备回调在主线程，acquire/toggle 来自协程或 UI——内部状态统一 [lock] 保护，
 * 回调 owner 一律在锁外进行（owner 自身方法可能也是 @Synchronized，避免交叉死锁）。
 */
@Singleton
class CallAudioRouter @Inject constructor(
    @ApplicationContext private val context: Context,
    @AppScope private val scope: CoroutineScope,
) {
    /** owner 回调：路由变化同步到各自 state；焦点事件交由 owner 处理麦克风/提示音。 */
    interface Listener {
        fun onRouteChanged(speakerOn: Boolean, bluetoothOn: Boolean, bluetoothAvailable: Boolean)
        /** 系统电话抢走焦点：owner 应静音麦克风（记住原状态，GAIN 时恢复）。 */
        fun onSystemCallInterrupted() {}
        /** 焦点丢失（任何原因）：owner 可停循环提示音。 */
        fun onFocusLost() {}
        /** 焦点恢复（GAIN 或重新申请成功）：owner 恢复麦克风/补播提示音。 */
        fun onFocusRegained() {}
    }

    private enum class Route { EARPIECE, SPEAKER, BLUETOOTH }

    private val audioManager: AudioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val lock = Any()

    // ── 以下状态均在 lock 内读写 ──
    private val owners = mutableListOf<Listener>()   // 最后一个为当前回调对象
    private var active = false
    private var hasFocus = false
    private var isVideo = false
    private var route = Route.EARPIECE
    private var btPending = false                    // <31：已 startBluetoothSco，等 SCO_AUDIO_STATE_CONNECTED
    private var btAvailable = false
    private var focusReacquireJob: Job? = null
    private var btPendingTimeoutJob: Job? = null
    private var receiverRegistered = false
    private var deviceCallbackRegistered = false

    val speakerOn: Boolean get() = synchronized(lock) { route == Route.SPEAKER }
    val bluetoothOn: Boolean get() = synchronized(lock) { route == Route.BLUETOOTH }

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change -> onFocusChange(change) }

    // <31 蓝牙 SCO 状态：startBluetoothSco 是异步的，真正 CONNECTED 后才切路由（B-5）。
    private val bluetoothScoReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: android.content.Intent) {
            // ACTION_SCO_AUDIO_STATE_UPDATED 是粘性广播，注册时会立刻补发当前状态(通常 DISCONNECTED)，
            // 不能当成"SCO 启动失败"处理
            if (isInitialStickyBroadcast) return
            val scoState = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR)
            onScoStateChanged(scoState)
        }
    }

    // 蓝牙耳机连接/断开：刷新"可切蓝牙"标记；31+ 正在走蓝牙时耳机消失 → 按通话类型回退。
    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) { onDevicesChanged() }
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) { onDevicesChanged() }
    }

    // ── 对外接口 ───────────────────────────────────────────
    /** 进入通话音频。已持有时只登记 owner（不重置路由选择），返回是否首次真正获取。 */
    fun acquire(owner: Listener, video: Boolean): Boolean {
        var first = false
        synchronized(lock) {
            owners.remove(owner); owners.add(owner)
            if (!active) {
                first = true
                active = true
                isVideo = video
                setCommunicationMode()
                hasFocus = requestFocus()
                if (!hasFocus) Log.w(TAG, "申请通话音频焦点失败，稍后重试")
                registerCallbacks()
                btAvailable = detectBluetoothHeadset()
                // 有已连接蓝牙耳机时默认优先走蓝牙(更符合"戴着耳机打电话"的预期)，否则语音听筒/视频扬声器
                applyRoute(if (btAvailable) Route.BLUETOOTH else defaultRoute())
                if (!hasFocus) scheduleFocusReacquire(0)
            }
        }
        notifyRoute()
        return first
    }

    /** owner 退出通话。仅当没有其他 owner 时才释放焦点/路由并恢复 MODE_NORMAL。 */
    fun release(owner: Listener) {
        synchronized(lock) {
            owners.remove(owner)
            if (!active || owners.isNotEmpty()) return
            active = false
            hasFocus = false
            focusReacquireJob?.cancel(); focusReacquireJob = null
            btPendingTimeoutJob?.cancel(); btPendingTimeoutJob = null
            @Suppress("DEPRECATION")
            runCatching { audioManager.abandonAudioFocus(focusListener) }
                .onFailure { e -> Log.w(TAG, "释放音频焦点失败: ${e.message}") }
            unregisterCallbacks()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                runCatching { audioManager.clearCommunicationDevice() }
            } else {
                stopSco()
                @Suppress("DEPRECATION")
                runCatching { audioManager.isSpeakerphoneOn = false }
            }
            btPending = false
            route = Route.EARPIECE
            btAvailable = false
            runCatching { audioManager.mode = AudioManager.MODE_NORMAL }
        }
    }

    /** 通话类型变化（降级/切视频）只影响 SCO 失败时的回退目标，不改当前路由。 */
    fun setVideo(video: Boolean) {
        synchronized(lock) { isVideo = video }
    }

    /** 切换扬声器/听筒（与蓝牙互斥：开扬声器会先关蓝牙）。 */
    fun toggleSpeaker() {
        synchronized(lock) {
            if (!active) return
            applyRoute(if (route == Route.SPEAKER) Route.EARPIECE else Route.SPEAKER)
        }
        notifyRoute()
    }

    /** 切换蓝牙路由（与扬声器互斥）。正在等待 SCO 建立时再点视为取消。 */
    fun toggleBluetooth() {
        synchronized(lock) {
            if (!active) return
            val on = route == Route.BLUETOOTH || btPending
            if (on) applyRoute(defaultRoute()) else applyRoute(Route.BLUETOOTH)
        }
        notifyRoute()
    }

    // ── 焦点 ───────────────────────────────────────────────
    private fun onFocusChange(change: Int) {
        var event: ((Listener) -> Unit)? = null
        var systemCall = false
        synchronized(lock) {
            if (!active) return
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS,
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                    hasFocus = false
                    val mode = currentMode()
                    if (mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_RINGTONE) {
                        // 系统电话：交 owner 静音麦克风，等系统电话结束的 GAIN
                        systemCall = true
                        focusReacquireJob?.cancel(); focusReacquireJob = null
                    } else if (mode == AudioManager.MODE_IN_COMMUNICATION &&
                        change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                    ) {
                        // 很可能是其他 VoIP（微信通话等，申请的都是 GAIN_TRANSIENT）或短提示音：
                        // 不抢回，对方释放后系统会还 GAIN
                        focusReacquireJob?.cancel(); focusReacquireJob = null
                    } else {
                        // 永久丢失（其他 App 放音乐/视频）不会再回 GAIN → 1s 后主动重新申请
                        scheduleFocusReacquire(0)
                    }
                    event = { it.onFocusLost() }
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                    // 短时压低音量（导航播报/提示音）——通话流不受影响，显式忽略
                }
                AudioManager.AUDIOFOCUS_GAIN -> {
                    focusReacquireJob?.cancel(); focusReacquireJob = null
                    hasFocus = true
                    restoreModeAndRoute()
                    event = { it.onFocusRegained() }
                }
                else -> {}
            }
        }
        val owner = currentOwner() ?: return
        event?.invoke(owner)
        if (systemCall) owner.onSystemCallInterrupted()
        if (change == AudioManager.AUDIOFOCUS_GAIN) notifyRoute()
    }

    /** 重新申请焦点：首次 1s，失败按 1s/2s/4s… 退避，最多 FOCUS_REACQUIRE_MAX 次；系统电话期间放弃（等 GAIN）。 */
    private fun scheduleFocusReacquire(attempt: Int) {
        if (attempt == 0 && focusReacquireJob?.isActive == true) return
        if (attempt >= FOCUS_REACQUIRE_MAX) {
            Log.w(TAG, "重新申请音频焦点失败已达上限，等待系统归还")
            focusReacquireJob = null
            return
        }
        focusReacquireJob = scope.launch {
            delay(FOCUS_REACQUIRE_DELAY_MS shl attempt)
            var regained = false
            synchronized(lock) {
                if (!active || hasFocus) return@launch
                val mode = currentMode()
                if (mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_RINGTONE) return@launch
                setCommunicationMode()
                if (requestFocus()) {
                    hasFocus = true
                    focusReacquireJob = null
                    restoreModeAndRoute()
                    regained = true
                } else {
                    scheduleFocusReacquire(attempt + 1)
                }
            }
            if (regained) {
                currentOwner()?.onFocusRegained()
                notifyRoute()
            }
        }
    }

    private fun requestFocus(): Boolean {
        @Suppress("DEPRECATION")
        return runCatching {
            audioManager.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }.getOrDefault(false)
    }

    /** 焦点恢复：重新切 MODE_IN_COMMUNICATION 并按当前选择重放路由（被其他 App 改掉 mode/路由时纠正回来）。 */
    private fun restoreModeAndRoute() {
        setCommunicationMode()
        btAvailable = detectBluetoothHeadset()
        val target = if (btPending) Route.BLUETOOTH else route
        applyRoute(if (target == Route.BLUETOOTH && !btAvailable) defaultRoute() else target)
    }

    private fun setCommunicationMode() {
        runCatching { audioManager.mode = AudioManager.MODE_IN_COMMUNICATION }
            .onFailure { e -> Log.w(TAG, "切换通话音频模式失败: ${e.message}") }
    }

    private fun currentMode(): Int = runCatching { audioManager.mode }.getOrDefault(AudioManager.MODE_NORMAL)

    // ── 路由（lock 内调用）──────────────────────────────────
    private fun defaultRoute(): Route = if (isVideo) Route.SPEAKER else Route.EARPIECE

    private fun applyRoute(target: Route) {
        btPendingTimeoutJob?.cancel(); btPendingTimeoutJob = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) applyRouteApi31(target) else applyRouteLegacy(target)
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.S)
    private fun applyRouteApi31(target: Route) {
        btPending = false
        val wantType = when (target) {
            Route.BLUETOOTH -> AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            Route.SPEAKER -> AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
            Route.EARPIECE -> AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
        }
        val device = if (target == Route.BLUETOOTH && !hasBluetoothPermission()) null
        else runCatching { audioManager.availableCommunicationDevices.firstOrNull { it.type == wantType } }.getOrNull()
        val ok = device != null && runCatching { audioManager.setCommunicationDevice(device) }.getOrDefault(false)
        if (ok) {
            route = target
            return
        }
        when (target) {
            Route.BLUETOOTH -> {
                // 蓝牙设备不在/切换失败 → 按通话类型回退
                Log.w(TAG, "切换蓝牙通话设备失败，按通话类型回退")
                applyRouteApi31(defaultRoute())
            }
            Route.EARPIECE -> {
                // 平板等无听筒设备：交还系统默认
                runCatching { audioManager.clearCommunicationDevice() }
                route = Route.EARPIECE
            }
            Route.SPEAKER -> {
                Log.w(TAG, "切换扬声器失败")
                route = Route.SPEAKER
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun applyRouteLegacy(target: Route) {
        when (target) {
            Route.BLUETOOTH -> {
                if (!btAvailable) { applyRouteLegacy(defaultRoute()); return }
                if (route == Route.BLUETOOTH && !btPending) {
                    // 已在蓝牙（焦点恢复重放）：SCO 链路仍在，只需把被改掉的路由标记纠正回来
                    runCatching { audioManager.isSpeakerphoneOn = false }
                    runCatching { audioManager.isBluetoothScoOn = true }
                    return
                }
                // B-5：只发起 SCO，等 receiver 收到 CONNECTED 再真正切蓝牙；期间先走听筒
                runCatching { audioManager.isSpeakerphoneOn = false }
                val started = runCatching { audioManager.startBluetoothSco() }
                    .onFailure { e -> Log.w(TAG, "启动蓝牙 SCO 失败: ${e.message}") }
                    .isSuccess
                if (!started) { applyRouteLegacy(defaultRoute()); return }
                btPending = true
                route = Route.EARPIECE
                // SCO 迟迟不建立（耳机不支持/被其他 App 占用）→ 超时按通话类型回退
                btPendingTimeoutJob = scope.launch {
                    delay(SCO_CONNECT_TIMEOUT_MS)
                    synchronized(lock) {
                        if (!active || !btPending) return@launch
                        Log.w(TAG, "蓝牙 SCO 建立超时，按通话类型回退")
                        btPending = false
                        stopSco()
                        applyRouteLegacy(defaultRoute())
                    }
                    notifyRoute()
                }
            }
            Route.SPEAKER, Route.EARPIECE -> {
                if (route == Route.BLUETOOTH || btPending) stopSco()
                btPending = false
                runCatching { audioManager.isSpeakerphoneOn = target == Route.SPEAKER }
                route = target
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun stopSco() {
        runCatching { audioManager.stopBluetoothSco() }
            .onFailure { e -> Log.w(TAG, "停止蓝牙 SCO 失败: ${e.message}") }
        runCatching { audioManager.isBluetoothScoOn = false }
    }

    @Suppress("DEPRECATION")
    private fun onScoStateChanged(scoState: Int) {
        synchronized(lock) {
            if (!active || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return
            when (scoState) {
                AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
                    if (!btPending) return   // 非我方发起/已被用户取消
                    btPendingTimeoutJob?.cancel(); btPendingTimeoutJob = null
                    btPending = false
                    runCatching { audioManager.isBluetoothScoOn = true }
                    runCatching { audioManager.isSpeakerphoneOn = false }
                    route = Route.BLUETOOTH
                }
                AudioManager.SCO_AUDIO_STATE_DISCONNECTED,
                AudioManager.SCO_AUDIO_STATE_ERROR -> {
                    // SCO 意外断开（耳机摘下/关机）或建立失败 → 按通话类型回退。用户主动切走蓝牙时
                    // route/btPending 已先改掉，这里自然不处理，不会覆盖用户刚切的扬声器（B-5）。
                    if (route != Route.BLUETOOTH && !btPending) return
                    btPending = false
                    runCatching { audioManager.isBluetoothScoOn = false }
                    btAvailable = detectBluetoothHeadset()
                    applyRouteLegacy(defaultRoute())
                }
                else -> return   // CONNECTING：等终态
            }
        }
        notifyRoute()
    }

    /** 权限刚授予（BLUETOOTH_CONNECT）等场景：重新探测蓝牙耳机可用性。 */
    fun refreshDevices() = onDevicesChanged()

    private fun onDevicesChanged() {
        synchronized(lock) {
            if (!active) return
            btAvailable = detectBluetoothHeadset()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && route == Route.BLUETOOTH && !btAvailable) {
                Log.w(TAG, "蓝牙耳机已断开，按通话类型回退")
                applyRouteApi31(defaultRoute())
            }
        }
        notifyRoute()
    }

    // ── 设备/权限 ──────────────────────────────────────────
    private fun hasBluetoothPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return androidx.core.content.ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.BLUETOOTH_CONNECT,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    /** 是否有可承载通话音频的蓝牙耳机：只认 SCO（HFP），只连 A2DP 的设备不算。无权限时保守返回 false。 */
    private fun detectBluetoothHeadset(): Boolean {
        if (!hasBluetoothPermission()) return false
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.availableCommunicationDevices.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            } else {
                audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            }
        }.getOrDefault(false)
    }

    private fun registerCallbacks() {
        if (!deviceCallbackRegistered) {
            runCatching { audioManager.registerAudioDeviceCallback(deviceCallback, null) }
                .onSuccess { deviceCallbackRegistered = true }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && !receiverRegistered) {
            runCatching {
                context.registerReceiver(
                    bluetoothScoReceiver,
                    android.content.IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED),
                )
                receiverRegistered = true
            }
        }
    }

    private fun unregisterCallbacks() {
        if (deviceCallbackRegistered) {
            runCatching { audioManager.unregisterAudioDeviceCallback(deviceCallback) }
            deviceCallbackRegistered = false
        }
        if (receiverRegistered) {
            runCatching { context.unregisterReceiver(bluetoothScoReceiver) }
            receiverRegistered = false
        }
    }

    // ── owner 回调（锁外）──────────────────────────────────
    private fun currentOwner(): Listener? = synchronized(lock) { owners.lastOrNull() }

    private fun notifyRoute() {
        val (snapshot, targets) = synchronized(lock) {
            if (!active) return
            Triple(route == Route.SPEAKER, route == Route.BLUETOOTH, btAvailable) to owners.toList()
        }
        targets.forEach { it.onRouteChanged(snapshot.first, snapshot.second, snapshot.third) }
    }

    private companion object {
        const val TAG = "CallAudioRouter"
        const val FOCUS_REACQUIRE_DELAY_MS = 1_000L
        const val FOCUS_REACQUIRE_MAX = 5
        const val SCO_CONNECT_TIMEOUT_MS = 5_000L
    }
}
