package com.touliao.app.core.call

import android.content.Context
import android.util.Log
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.core.di.AppScope
import com.touliao.app.core.realtime.SocketManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import javax.inject.Inject
import javax.inject.Singleton

enum class CallStage { IDLE, OUTGOING, INCOMING, CONNECTING, CONNECTED, ENDED }

data class CallState(
    val stage: CallStage = CallStage.IDLE,
    val peerId: String = "",
    val peerName: String = "",
    val isVideo: Boolean = false,
    val isCaller: Boolean = false,
    val callId: String = "",          // 服务端通话 id，随 accept/reject/hangup 回传做过期应答校验
    val micEnabled: Boolean = true,
    val cameraEnabled: Boolean = true,
    val speakerOn: Boolean = false,   // 2026-08-29 语音通话审计新增：此前完全没有扬声器切换能力
    val bluetoothOn: Boolean = false,       // 2026-08-29 补充：蓝牙SCO是否已路由
    val bluetoothAvailable: Boolean = false, // 通话期间是否检测到已连接的蓝牙耳机
    val remoteVideoActive: Boolean = false,
    val connectedAt: Long = 0,        // 接通时刻(elapsedRealtime ms)，用于通话计时
    val endedAt: Long = 0,            // 结束时刻(elapsedRealtime ms)，用于结束页定格总时长
    // 2026-08-29新增：通话小窗(对齐iOS)。true时CallHost渲染悬浮小窗而非全屏通话界面，
    // 用户可退回App其它页面继续操作，PeerConnection/信令不受UI切换影响。
    val isMinimized: Boolean = false,
)

/**
 * WebRTC 1对1 音视频通话。信令走 SocketManager（call:* 事件，纯转发）。
 * 单活动通话；UI 通过 [state] 观察，并取 [localVideoTrack]/[remoteVideoTrack] 渲染。
 */
@Singleton
class CallManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val socketManager: SocketManager,
    private val sessionManager: SessionManager,
    private val turnApi: com.touliao.app.data.api.TurnApi,
    private val notificationHelper: com.touliao.app.core.push.NotificationHelper,
    @AppScope private val scope: CoroutineScope,
) {
    val eglBase: EglBase = EglBase.create()

    // ── 音频路由(2026-08-29语音通话审计新增)：此前无 AudioManager 相关代码，通话音频
    // 路由/焦点完全交给系统默认行为——没有扬声器切换、没有主动抢音频焦点、系统来电/
    // 其他App抢焦点时也没有回调处理。这里补上最小可用实现：MODE_IN_COMMUNICATION +
    // 请求音频焦点 + 扬声器开关；音频焦点丢失(如系统来电)时自动静音麦克风，
    // 恢复焦点后恢复原有静音状态，避免"接了系统电话，投聊还在发送声音"。
    private val audioManager: android.media.AudioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
    private var micEnabledBeforeFocusLoss = true
    private val audioFocusListener = android.media.AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            android.media.AudioManager.AUDIOFOCUS_LOSS,
            android.media.AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                micEnabledBeforeFocusLoss = _state.value.micEnabled
                localAudioTrack?.setEnabled(false)
                _state.update { it.copy(micEnabled = false) }
            }
            android.media.AudioManager.AUDIOFOCUS_GAIN -> {
                localAudioTrack?.setEnabled(micEnabledBeforeFocusLoss)
                _state.update { it.copy(micEnabled = micEnabledBeforeFocusLoss) }
            }
        }
    }

    // 蓝牙SCO(2026-08-29语音通话审计补充)：此前扬声器切换只处理了听筒/扬声器二选一，
    // 完全没碰蓝牙——已配对耳机连接时无法路由通话音频到蓝牙，也没有断开自动回退。
    // 需要 BLUETOOTH_CONNECT 运行时权限(API 31+)；未授权时不崩，只是蓝牙按钮不可用/不显示，
    // 由调用方(CallScreen)据 state.bluetoothAvailable 决定是否展示入口。
    private var bluetoothScoReceiverRegistered = false
    private val bluetoothScoReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: android.content.Intent) {
            val scoState = intent.getIntExtra(
                android.media.AudioManager.EXTRA_SCO_AUDIO_STATE,
                android.media.AudioManager.SCO_AUDIO_STATE_ERROR,
            )
            val connected = scoState == android.media.AudioManager.SCO_AUDIO_STATE_CONNECTED
            _state.update { it.copy(bluetoothOn = connected) }
        }
    }

    private fun hasBluetoothPermission(): Boolean {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) return true
        return androidx.core.content.ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.BLUETOOTH_CONNECT,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    /** 是否检测到已连接的蓝牙音频设备(耳机/车载等，SCO可路由的类型)。无权限时保守返回false。 */
    private fun hasBluetoothHeadset(): Boolean {
        if (!hasBluetoothPermission()) return false
        return runCatching {
            audioManager.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS).any {
                it.type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    it.type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
            }
        }.getOrDefault(false)
    }

    private fun acquireAudioFocusAndRoute() {
        audioManager.mode = android.media.AudioManager.MODE_IN_COMMUNICATION
        @Suppress("DEPRECATION")
        audioManager.requestAudioFocus(
            audioFocusListener,
            android.media.AudioManager.STREAM_VOICE_CALL,
            android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
        )
        if (hasBluetoothPermission()) {
            runCatching {
                context.registerReceiver(
                    bluetoothScoReceiver,
                    android.content.IntentFilter(android.media.AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED),
                )
                bluetoothScoReceiverRegistered = true
            }
        }
        val btAvailable = hasBluetoothHeadset()
        // 有已连接蓝牙耳机时默认优先走蓝牙(更符合"戴着耳机打电话"的预期)，
        // 否则维持原逻辑：语音通话默认听筒，视频通话默认扬声器。
        val defaultSpeaker = !btAvailable && _state.value.isVideo
        if (btAvailable) {
            @Suppress("DEPRECATION")
            runCatching { audioManager.startBluetoothSco() }
                .onFailure { e -> Log.w(TAG, "启动蓝牙 SCO 失败: ${e.message}") }
            audioManager.isBluetoothScoOn = true
        } else {
            audioManager.isSpeakerphoneOn = defaultSpeaker
        }
        _state.update { it.copy(speakerOn = defaultSpeaker, bluetoothAvailable = btAvailable, bluetoothOn = btAvailable) }
    }

    private fun releaseAudioFocusAndRoute() {
        @Suppress("DEPRECATION")
        runCatching { audioManager.abandonAudioFocus(audioFocusListener) }
                .onFailure { e -> Log.w(TAG, "释放音频焦点失败: ${e.message}") }
        if (bluetoothScoReceiverRegistered) {
            runCatching { context.unregisterReceiver(bluetoothScoReceiver) }
            bluetoothScoReceiverRegistered = false
        }
        @Suppress("DEPRECATION")
        runCatching { audioManager.stopBluetoothSco() }
                .onFailure { e -> Log.w(TAG, "停止蓝牙 SCO 失败: ${e.message}") }
        audioManager.isBluetoothScoOn = false
        audioManager.isSpeakerphoneOn = false
        audioManager.mode = android.media.AudioManager.MODE_NORMAL
    }

    /** 切换扬声器/听筒(与蓝牙互斥：开扬声器会先关蓝牙路由)。 */
    fun toggleSpeaker() {
        val enabled = !_state.value.speakerOn
        if (enabled && _state.value.bluetoothOn) {
            @Suppress("DEPRECATION")
            runCatching { audioManager.stopBluetoothSco() }
            audioManager.isBluetoothScoOn = false
        }
        audioManager.isSpeakerphoneOn = enabled
        _state.update { it.copy(speakerOn = enabled, bluetoothOn = if (enabled) false else it.bluetoothOn) }
    }

    /** 切换蓝牙路由(与扬声器互斥)。仅在 state.bluetoothAvailable 时应被UI调用。 */
    fun toggleBluetooth() {
        val enabled = !_state.value.bluetoothOn
        if (enabled) {
            @Suppress("DEPRECATION")
            runCatching { audioManager.startBluetoothSco() }
            audioManager.isBluetoothScoOn = true
            audioManager.isSpeakerphoneOn = false
        } else {
            @Suppress("DEPRECATION")
            runCatching { audioManager.stopBluetoothSco() }
            audioManager.isBluetoothScoOn = false
        }
        _state.update { it.copy(bluetoothOn = enabled, speakerOn = if (enabled) false else it.speakerOn) }
    }

    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var callTimeoutJob: Job? = null   // 主叫呼出超时:对方无应答/断线时自动收尾,防卡死"呼叫中"
    // ICE restart 自愈(网络切换 Wi-Fi↔4G):disconnected 3s 防抖 → restartIce → 15s 窗口 → 最多 3 次 → 挂断。
    // 信令复用现有 call:offer/answer/ice(后端纯转发零改动),对端收到 offer 走现有应答逻辑。
    private var iceRestartDebounceJob: Job? = null   // disconnected 防抖(短时探测间隙自愈)
    private var iceRestartRecoverJob: Job? = null    // restart 后等待 connected 的窗口
    private var iceRestartCount = 0                  // 连续重启次数,恢复后清零
    @Volatile private var callAttempt = 0L   // 主叫呼出序号：ack 延迟时防止旧 callId 写入新一次呼出（P2-1 @Volatile 防跨线程撕裂）
    private var audioSource: org.webrtc.AudioSource? = null
    private var videoSource: VideoSource? = null
    private var localAudioTrack: AudioTrack? = null
    private var videoCapturer: VideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null

    var localVideoTrack: VideoTrack? = null
        private set
    var remoteVideoTrack: VideoTrack? = null
        private set

    // ICE 候选缓存 + 远端描述就绪标志：ICE 事件在协程线程读写，onSetSuccess/drainIce 在 WebRTC
    // 自己的信令线程回调 → 跨线程。必须同锁保护「查标志→入队/直加」与「置标志→排空」两段的原子性，
    // 否则存在竞态：ICE 处理读到 remoteDescSet==false，此刻 onSetSuccess 在另一线程置位并排空空队列，
    // ICE 再把候选压进 pendingIce → 该候选永不排空 → 连接卡在 CONNECTING。并发迭代还会 CME。
    private val iceLock = Any()
    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteDescSet = false

    private val _state = MutableStateFlow(CallState())
    /** 通话音量=0(回铃音无声根因之一):CallScreen 据此提示用户调高音量 */
    val voiceCallVolumeZero = MutableStateFlow(false)
    val state: StateFlow<CallState> = _state.asStateFlow()

    // STUN-only 兜底；通话前 refreshIceServers() 会向后端拉取含 TURN 的完整列表
    private val fallbackIceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
    )
    @Volatile
    private var iceServers: List<PeerConnection.IceServer> = fallbackIceServers

    /** 通话建立前刷新 ICE（含时效 TURN 凭证）。失败保留兜底，不阻断通话。 */
    private suspend fun refreshIceServers() {
        try {
            val creds = turnApi.getCredentials()
            val servers = creds.iceServers.mapNotNull { dto ->
                if (dto.urls.isEmpty()) return@mapNotNull null
                PeerConnection.IceServer.builder(dto.urls).apply {
                    dto.username?.let { setUsername(it) }
                    dto.credential?.let { setPassword(it) }
                }.createIceServer()
            }
            if (servers.isNotEmpty()) iceServers = servers
        } catch (e: Exception) {
            Log.w("CallManager", "refreshIceServers failed, using fallback STUN", e)
        }
    }

    init {
        ensureFactory()
        observeSignaling()
    }

    private fun ensureFactory() {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    // ── 对外动作 ───────────────────────────────────────────
    /** 主叫发起 */
    fun startCall(peerId: String, peerName: String, video: Boolean) {
        if (_state.value.stage != CallStage.IDLE && _state.value.stage != CallStage.ENDED) return
        val attempt = ++callAttempt          // 本次呼出序号，ack 回填时校验（P2）
        _state.value = CallState(CallStage.OUTGOING, peerId, peerName, isVideo = video, isCaller = true)
        // 先切通话音频模式(MODE_IN_COMMUNICATION + 音频焦点)再播回铃音:
        // ToneGenerator 走 STREAM_VOICE_CALL,未切模式/无焦点时部分 ROM 不发声
        // (此前回铃音先播、acquireAudioFocusAndRoute 在建流时才执行——顺序反了)
        acquireAudioFocusAndRoute()
        playRingbackTone()                  // 主叫拨出→接通前循环回铃音（接通/挂断时停）
        // 本地呼出超时:60s 内未接通(对方不接/断线,后端 timeout 不向主叫发事件)则自动挂断收尾,
        // 防止界面永远卡在"呼叫中"。接通(CONNECTED)或挂断时取消(见 cleanup / IceConnectionState)。
        callTimeoutJob?.cancel()
        callTimeoutJob = scope.launch {
            delay(60_000)
            val st = _state.value.stage
            if (st == CallStage.OUTGOING || st == CallStage.CONNECTING) {
                if (_state.value.peerId.isNotEmpty()) socketManager.emitCallEnd(_state.value.peerId, _state.value.callId)
                cleanup(CallStage.ENDED)
            }
        }
        scope.launch {
            refreshIceServers()                 // 先拿到含 TURN 的 ICE，再建连接
            // generation 前置校验（P1-2）：挂断→秒重拨后旧协程恢复时不得继续建连/采音/发请求，
            // 否则泄漏 PeerConnection/摄像头并产生幽灵 call:request
            if (attempt != callAttempt || _state.value.stage != CallStage.OUTGOING) return@launch
            createPeerConnection()
            createLocalTracks(video)
            // 本地媒体已开始采集（麦克风/摄像头）→ 起前台服务保活（此刻 App 在前台、权限已授予，满足 FGS 合规）
            CallForegroundService.start(context, video)
            val name = sessionManager.currentUser?.username.orEmpty()
            // ack 携带服务端生成的 callId；期间可能已挂断/重拨/被覆盖，仅在仍是同一通呼出时才回填（attempt 序号 + peer + stage 三重校验）
            val callId = socketManager.emitCallRequest(peerId, if (video) "video" else "audio", name)
            if (callId == null) {
                // ack 超时/socket 未连/请求被拒（P1-4）：立即收尾并提示，不再静默回铃 60s
                if (attempt == callAttempt && _state.value.stage == CallStage.OUTGOING) cleanup(CallStage.ENDED)
                return@launch
            }
            if (attempt == callAttempt && _state.value.peerId == peerId && _state.value.stage != CallStage.ENDED) {
                _state.update { it.copy(callId = callId) }
            }
        }
    }

    /** 被叫接听 */
    fun accept() {
        val s = _state.value
        if (s.stage != CallStage.INCOMING) return
        _state.update { it.copy(stage = CallStage.CONNECTING) }
        scope.launch {
            refreshIceServers()
            if (_state.value.stage == CallStage.ENDED) return@launch
            createPeerConnection()
            createLocalTracks(s.isVideo)
            // 本地媒体已开始采集 → 起前台服务保活（接听时 App 在前台、权限已授予）
            CallForegroundService.start(context, s.isVideo)
            socketManager.emitCallResponse(s.peerId, true, s.callId)
            // 等待主叫的 call:offer
        }
    }

    /** 被叫拒接 */
    fun reject() {
        val s = _state.value
        if (s.peerId.isNotEmpty()) socketManager.emitCallResponse(s.peerId, false, s.callId)
        cleanup(CallStage.ENDED)
    }

    /** 挂断（任一方） */
    fun hangup() {
        val s = _state.value
        if (s.peerId.isNotEmpty()) socketManager.emitCallEnd(s.peerId, s.callId)
        cleanup(CallStage.ENDED)
    }

    // ── ICE restart 自愈(网络切换) ─────────────────────────────
    // disconnected 3s 防抖 → restartIce() → 15s 恢复窗口 → 未恢复重试,最多 3 次 → 挂断。
    // 信令复用现有 call:offer/answer/ice;对端收到重协商 offer 走现有应答逻辑,后端零改动。
    private fun tryIceRestart() {
        val pc = peerConnection ?: return
        if (iceRestartCount >= ICE_RESTART_MAX) { endCallByNetwork(); return }
        iceRestartCount++
        pc.restartIce()
        iceRestartRecoverJob?.cancel()
        iceRestartRecoverJob = scope.launch {
            delay(ICE_RESTART_WINDOW_MS)
            val st = peerConnection?.iceConnectionState()
            if (st == PeerConnection.IceConnectionState.DISCONNECTED ||
                st == PeerConnection.IceConnectionState.FAILED
            ) tryIceRestart()
            else iceRestartRecoverJob = null
        }
    }

    /** 网络不可恢复:通知对方 + 收尾(对齐 iOS failed 分支:不能静默挂断) */
    private fun endCallByNetwork() {
        iceRestartDebounceJob?.cancel(); iceRestartDebounceJob = null
        iceRestartRecoverJob?.cancel(); iceRestartRecoverJob = null
        val s = _state.value
        if (s.peerId.isNotEmpty()) socketManager.emitCallEnd(s.peerId, s.callId)
        cleanup(CallStage.ENDED)
    }

    /** 通话小窗：最小化/恢复全屏。只切UI呈现，不碰PeerConnection/信令。 */
    fun setMinimized(minimized: Boolean) {
        _state.update { it.copy(isMinimized = minimized) }
    }

    fun toggleMic() {
        val enabled = !_state.value.micEnabled
        localAudioTrack?.setEnabled(enabled)
        _state.update { it.copy(micEnabled = enabled) }
    }

    fun toggleCamera() {
        val enabled = !_state.value.cameraEnabled
        localVideoTrack?.setEnabled(enabled)
        _state.update { it.copy(cameraEnabled = enabled) }
    }

    fun switchCamera() {
        (videoCapturer as? CameraVideoCapturer)?.switchCamera(null)
    }

    fun consumeEnded() {
        if (_state.value.stage == CallStage.ENDED) _state.value = CallState()
    }

    /**
     * 由后台 FCM 来电推送触发进入 INCOMING（App 被通知拉起、socket 可能尚未重连时）。
     * 幂等：若已在展示同一来电或正在通话则不覆盖；socket 后续补发 call:incoming 会因 peer 相同被去重。
     */
    fun incomingFromPush(from: String, callType: String, callerName: String, callId: String = "") {
        if (from.isEmpty()) return
        // 原子读-改-写（P2-3）：stage 判断与写入放同一临界区，防 Default 线程 socket collect 与
        // 主线程 push 处理 TOCTOU；已展示同 peer 来电时仅升级 callId（防过期通知带旧 id 应答被服务端丢弃）
        _state.update { st ->
            if (st.stage == CallStage.IDLE || st.stage == CallStage.ENDED) {
                CallState(
                    CallStage.INCOMING, from, callerName, isVideo = callType == "video", isCaller = false, callId = callId,
                )
            } else if (st.stage == CallStage.INCOMING && st.peerId == from && callId.isNotEmpty() && st.callId != callId) {
                st.copy(callId = callId)
            } else {
                st  // 正在通话/展示其他来电 → 不覆盖
            }
        }
    }

    // ── 信令处理 ───────────────────────────────────────────
    private fun observeSignaling() {
        scope.launch {
            socketManager.status.filter { it == com.touliao.app.core.realtime.SocketStatus.CONNECTED }.collect {
                val s = _state.value
                if (s.callId.isNotEmpty() && s.stage != CallStage.IDLE && s.stage != CallStage.ENDED) {
                    socketManager.emitCallResume(s.callId)
                }
            }
        }
        scope.launch {
            socketManager.callOutgoingEvents.collect { e ->
                if (_state.value.stage == CallStage.IDLE || _state.value.stage == CallStage.ENDED) {
                    _state.value = CallState(
                        stage = CallStage.OUTGOING,
                        peerId = e.to,
                        isVideo = e.type == "video",
                        callId = e.callId,
                    )
                }
            }
        }
        scope.launch {
            socketManager.callIncomingEvents.collect { e ->
                // 已在展示同一 peer 的来电：仅当 callId 相同才是重复事件（同一通），直接忽略；
                // callId 不同 = 主叫重拨的新一通 → 覆盖旧状态（callId/isVideo/callerName 一并更新，
                // 防应答带过期 callId 被服务端忽略、防 audio/video 类型降级）（P1 + P2-2）
                if (_state.value.stage == CallStage.INCOMING && _state.value.peerId == e.from) {
                    if (e.callId.isNotEmpty() && _state.value.callId != e.callId) {
                        _state.update { it.copy(callId = e.callId, isVideo = e.type == "video", peerName = e.callerName) }
                    }
                    return@collect
                }
                if (_state.value.stage != CallStage.IDLE && _state.value.stage != CallStage.ENDED) {
                    // 忙线：直接拒接
                    socketManager.emitCallResponse(e.from, false, e.callId)
                    return@collect
                }
                _state.value = CallState(
                    CallStage.INCOMING, e.from, e.callerName, isVideo = e.type == "video", isCaller = false, callId = e.callId,
                )
                // 2026-08-30 修复：此前这里只更新内存状态，没有弹系统通知——只有 FCM 推送
                // （TouliaoMessagingService.onMessageReceived）才会调 showCallNotification()。
                // 但后端只在 presence 判定被叫离线（socket 未连）时才发 FCM 推送；Android 后台
                // 保活能力通常比 iOS 强，App 在锁屏/后台但 socket 仍连着是常见情况——这种情况下
                // 来电完全走这条 live socket 通路，之前没有任何系统级提醒，用户看不到也听不到。
                // 补上跟 FCM 分支一致的调用，不加前台判断（跟 TouliaoMessagingService 里来电
                // 分支同样不判断 appForeground 一致——来电需要总是弹出，不像普通消息前台会有
                // 应用内实时更新可以替代通知）。
                notificationHelper.showCallNotification(
                    callId = e.callId, from = e.from, callerName = e.callerName, callType = e.type,
                )
            }
        }
        scope.launch {
            socketManager.callResponseEvents.collect { e ->
                val s = _state.value
                // stage 守卫（P2-5）：主叫挂断瞬间被叫恰好接听，迟到的 accepted 不得把 ENDED 重新唤醒回 CONNECTING
                if (!s.isCaller || !CallSignalMatcher.matches(s.callId, e.callId, s.peerId, e.from) || s.stage != CallStage.OUTGOING) return@collect
                if (e.accepted) {
                    _state.update { it.copy(stage = CallStage.CONNECTING) }
                    createOfferAndSend()
                } else {
                    cleanup(CallStage.ENDED)
                }
            }
        }
        scope.launch {
            socketManager.callOfferEvents.collect { e ->
                val s = _state.value
                if (!CallSignalMatcher.matches(s.callId, e.callId, s.peerId, e.from)) return@collect
                val pc = peerConnection ?: return@collect
                pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        drainIce()   // 锁内置位 remoteDescSet 并排空缓存的候选
                        createAnswerAndSend()
                    }
                }, SessionDescription(SessionDescription.Type.OFFER, e.sdp))
            }
        }
        scope.launch {
            socketManager.callAnswerEvents.collect { e ->
                val s = _state.value
                if (!CallSignalMatcher.matches(s.callId, e.callId, s.peerId, e.from)) return@collect
                val pc = peerConnection ?: return@collect
                pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() { drainIce() }   // 锁内置位 remoteDescSet 并排空
                }, SessionDescription(SessionDescription.Type.ANSWER, e.sdp))
            }
        }
        scope.launch {
            socketManager.callIceEvents.collect { e ->
                val s = _state.value
                if (!CallSignalMatcher.matches(s.callId, e.callId, s.peerId, e.from)) return@collect
                val cand = IceCandidate(e.sdpMid, e.sdpMLineIndex, e.candidate)
                // 锁内「判断 + 加入/直排」原子化：与 drainIce 的「置位 + 排空」互斥，杜绝候选丢失竞态。
                synchronized(iceLock) {
                    if (remoteDescSet) peerConnection?.addIceCandidate(cand) else pendingIce.add(cand)
                }
            }
        }
        scope.launch {
            socketManager.callEndEvents.collect { e ->
                // 按 callId 匹配（P1-3 客户端侧）：旧通话迟到的 call:end 不得误杀重拨后的新来电；
                // 服务端旧版不带 callId 时兼容放行（callId 为空 → 仅按 peer 匹配，行为同旧版）
                val s = _state.value
                val matchesPeerCall = CallSignalMatcher.matches(s.callId, e.callId, s.peerId, e.from)
                val matchesOtherDeviceOutgoing = !s.isCaller && s.stage == CallStage.OUTGOING &&
                    (e.callId.isEmpty() || e.callId == s.callId)
                if (matchesPeerCall || matchesOtherDeviceOutgoing) {
                    cleanup(CallStage.ENDED)
                }
            }
        }
    }

    // 锁内「置位 remoteDescSet + 排空缓存候选」原子化：与 ICE 收集器的「判断 + 加入」互斥。
    // 置位与排空必须在同一临界区，否则先置位、排空前 ICE 线程读到 true 直排、本方再排空旧队列，
    // 顺序虽不丢但仍有窗口；一并纳入锁最稳。
    private fun drainIce() {
        synchronized(iceLock) {
            remoteDescSet = true
            pendingIce.forEach { peerConnection?.addIceCandidate(it) }
            pendingIce.clear()
        }
    }

    private fun createOfferAndSend() {
        val pc = peerConnection ?: return
        pc.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(SimpleSdpObserver(), desc)
                socketManager.emitCallOffer(_state.value.peerId, desc.description, _state.value.callId)
            }
        }, mediaConstraints())
    }

    private fun createAnswerAndSend() {
        val pc = peerConnection ?: return
        pc.createAnswer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(SimpleSdpObserver(), desc)
                socketManager.emitCallAnswer(_state.value.peerId, desc.description, _state.value.callId)
            }
        }, mediaConstraints())
    }

    private fun mediaConstraints() = MediaConstraints().apply {
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", if (_state.value.isVideo) "true" else "false"))
    }

    // ── WebRTC 构建 ────────────────────────────────────────
    private fun createPeerConnection() {
        val f = factory ?: return
        synchronized(iceLock) { remoteDescSet = false; pendingIce.clear() }
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        peerConnection = f.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                socketManager.emitCallIce(_state.value.peerId, candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex, _state.value.callId)
            }
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>?) {
                (receiver.track() as? VideoTrack)?.let { vt ->
                    remoteVideoTrack = vt
                    _state.update { it.copy(remoteVideoActive = true) }
                }
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED -> {
                        // 首次接通 或 restart 后恢复:清定时器 + 计数清零(可反复自愈)
                        iceRestartDebounceJob?.cancel(); iceRestartDebounceJob = null
                        iceRestartRecoverJob?.cancel(); iceRestartRecoverJob = null
                        iceRestartCount = 0
                        if (_state.value.connectedAt == 0L && _state.value.stage != CallStage.ENDED) playConnectedTone() // 首次接通→停回铃+接通音
                        _state.update {
                            if (it.stage != CallStage.ENDED)
                                it.copy(stage = CallStage.CONNECTED, connectedAt = if (it.connectedAt == 0L) android.os.SystemClock.elapsedRealtime() else it.connectedAt)
                            else it
                        }
                    }
                    PeerConnection.IceConnectionState.DISCONNECTED -> {
                        // 短时探测间隙(<3s 通常自愈,锁屏/后台):防抖后再重启,避免无谓重协商
                        iceRestartDebounceJob?.cancel()
                        iceRestartDebounceJob = scope.launch {
                            delay(ICE_RESTART_DEBOUNCE_MS)
                            tryIceRestart()
                        }
                    }
                    PeerConnection.IceConnectionState.FAILED -> {
                        // 首次 failed:给一次 restart 机会(可能临时网络黑洞);已重启过且非窗口期 → 挂断
                        if (iceRestartCount == 0 && iceRestartRecoverJob == null) tryIceRestart()
                        else if (iceRestartRecoverJob == null) endCallByNetwork()
                    }
                    PeerConnection.IceConnectionState.CLOSED -> { /* 由 call:end 或用户挂断收尾 */ }
                    else -> {}
                }
            }
            override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
            override fun onIceConnectionReceivingChange(p0: Boolean) {}
            override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
            override fun onAddStream(p0: MediaStream?) {}
            override fun onRemoveStream(p0: MediaStream?) {}
            override fun onDataChannel(p0: org.webrtc.DataChannel?) {}
            override fun onRenegotiationNeeded() {}
        })
    }

    private fun createLocalTracks(video: Boolean) {
        val f = factory ?: return
        val pc = peerConnection ?: return
        acquireAudioFocusAndRoute()
        // 音频
        audioSource = f.createAudioSource(MediaConstraints())
        localAudioTrack = f.createAudioTrack("audio0", audioSource).apply { setEnabled(true) }
        pc.addTrack(localAudioTrack, listOf(STREAM_ID))
        // 视频
        if (video) {
            val capturer = createCameraCapturer() ?: return
            videoCapturer = capturer
            surfaceHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
            videoSource = f.createVideoSource(false)
            capturer.initialize(surfaceHelper, context, videoSource!!.capturerObserver)
            runCatching { capturer.startCapture(1280, 720, 30) }
                .onFailure { e -> Log.w(TAG, "视频采集启动失败: ${e.message}") }
            localVideoTrack = f.createVideoTrack("video0", videoSource).apply { setEnabled(true) }
            pc.addTrack(localVideoTrack, listOf(STREAM_ID))
        }
    }

    private fun createCameraCapturer(): VideoCapturer? {
        val enumerator = Camera2Enumerator(context)
        val names = enumerator.deviceNames
        names.firstOrNull { enumerator.isFrontFacing(it) }?.let { return enumerator.createCapturer(it, null) }
        names.firstOrNull()?.let { return enumerator.createCapturer(it, null) }
        return null
    }

    // ── 清理 ──────────────────────────────────────────────
    private fun cleanup(finalStage: CallStage) {
        releaseTone()                                     // 停回铃/接通音并释放 ToneGenerator
        releaseAudioFocusAndRoute()                        // 恢复系统默认音频模式/释放焦点，防止占用
        callTimeoutJob?.cancel(); callTimeoutJob = null   // 接通/挂断/被拒 → 取消呼出超时
        iceRestartDebounceJob?.cancel(); iceRestartDebounceJob = null
        iceRestartRecoverJob?.cancel(); iceRestartRecoverJob = null
        CallForegroundService.stop(context)               // 停前台服务（未起过则 no-op）
        runCatching { videoCapturer?.stopCapture() }
        runCatching { videoCapturer?.dispose() }
        videoCapturer = null
        surfaceHelper?.dispose(); surfaceHelper = null
        localVideoTrack = null
        remoteVideoTrack = null
        runCatching { videoSource?.dispose() }; videoSource = null
        runCatching { audioSource?.dispose() }; audioSource = null
        localAudioTrack = null
        runCatching { peerConnection?.close() }
        runCatching { peerConnection?.dispose() }
        peerConnection = null
        synchronized(iceLock) { remoteDescSet = false; pendingIce.clear() }
        val cur = _state.value
        val ended = if (cur.connectedAt > 0L && cur.endedAt == 0L) android.os.SystemClock.elapsedRealtime() else cur.endedAt
        // 通话结束强制回到全屏(对齐iOS)：即便之前是小窗状态，也让用户看到结束态摘要。
        val forceFullScreen = finalStage == CallStage.ENDED
        _state.value = cur.copy(stage = finalStage, endedAt = ended, isMinimized = if (forceFullScreen) false else cur.isMinimized)
    }

    // ── 通话提示音（回铃/接通）─────────────────────────────
    // 走 STREAM_VOICE_CALL：随听筒/扬声器路由，且不受媒体/通知音量与静音开关影响，与原生通话体验一致。
    @Volatile
    private var toneGen: android.media.ToneGenerator? = null

    private fun ensureToneGen(): android.media.ToneGenerator? {
        if (toneGen == null) {
            toneGen = runCatching {
                android.media.ToneGenerator(android.media.AudioManager.STREAM_VOICE_CALL, 70)
            }.onFailure { e ->
                android.util.Log.w(TAG, "ToneGenerator 创建失败(回铃音将无声): ${e.message}")
            }.getOrNull()
        }
        return toneGen
    }

    /** 主叫呼出→接通前的循环回铃音（“嘟——嘟——”）。 */
    @Synchronized
    private fun playRingbackTone() {
        if (toneGen == null && ensureToneGen() == null) {
            android.util.Log.w(TAG, "回铃音未播放:ToneGenerator 不可用")
            return
        }
        runCatching { toneGen?.startTone(android.media.ToneGenerator.TONE_SUP_RINGTONE) }
            .onFailure { e -> android.util.Log.w(TAG, "回铃音播放失败: ${e.message}") }
        // 通话音量=0 时 ToneGenerator 无声——对外暴露,供 CallScreen 提示用户
        val vol = runCatching {
            audioManager.getStreamVolume(android.media.AudioManager.STREAM_VOICE_CALL)
        }.getOrDefault(1)
        voiceCallVolumeZero.value = vol == 0
    }

    /** 首次接通：停回铃并播一声短促接通提示音。 */
    @Synchronized
    private fun playConnectedTone() {
        val gen = ensureToneGen() ?: return
        runCatching { gen.stopTone() }
        runCatching { gen.startTone(android.media.ToneGenerator.TONE_PROP_ACK, 200) }
            .onFailure { e -> android.util.Log.w(TAG, "接通提示音播放失败: ${e.message}") }
    }

    /** 停止并释放 ToneGenerator（通话结束/清理时调用；幂等）。 */
    @Synchronized
    private fun releaseTone() {
        runCatching { toneGen?.stopTone() }
            .onFailure { e -> android.util.Log.w(TAG, "stopTone 失败: ${e.message}") }
        runCatching { toneGen?.release() }
            .onFailure { e -> android.util.Log.w(TAG, "ToneGenerator release 失败: ${e.message}") }
        toneGen = null
        voiceCallVolumeZero.value = false
    }

    private companion object {
        const val STREAM_ID = "stream0"
        const val TAG = "CallManager"
        // ICE restart 参数(与四端统一):防抖 3s / 恢复窗口 15s / 最大 3 次
        const val ICE_RESTART_DEBOUNCE_MS = 3000L
        const val ICE_RESTART_WINDOW_MS = 15000L
        const val ICE_RESTART_MAX = 3
    }
}

/** SdpObserver 默认空实现，按需重写 */
open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) { Log.w("CallManager", "sdp create fail: $error") }
    override fun onSetFailure(error: String?) { Log.w("CallManager", "sdp set fail: $error") }
}
