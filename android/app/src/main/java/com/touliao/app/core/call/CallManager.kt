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
import kotlinx.coroutines.isActive
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
import org.webrtc.RTCStatsCollectorCallback
import org.webrtc.RTCStatsReport
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
    // 2026-09-02新增：通话质量指示（getStats 2s 采样）。""=未采样 / good=优 / medium=中 / poor=差
    val callQuality: String = "",
    val connectedAt: Long = 0,        // 接通时刻(elapsedRealtime ms)，用于通话计时
    val endedAt: Long = 0,            // 结束时刻(elapsedRealtime ms)，用于结束页定格总时长
    // 2026-08-29新增：通话小窗(对齐iOS)。true时CallHost渲染悬浮小窗而非全屏通话界面，
    // 用户可退回App其它页面继续操作，PeerConnection/信令不受UI切换影响。
    val isMinimized: Boolean = false,
    // 发起被服务端拒绝时的原因（结束页显示，如「对方忙线中」）；空 = 普通结束
    val endMessage: String = "",
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
    private val userApi: com.touliao.app.data.api.UserApi,
    private val notificationHelper: com.touliao.app.core.push.NotificationHelper,
    private val audioRouter: CallAudioRouter,
    @AppScope private val scope: CoroutineScope,
) {
    val eglBase: EglBase = EglBase.create()

    init {
        // 来电铃声：启动时同步 user_settings.ringtone（设置页更新后也写入本字段即时生效）
        scope.launch {
            runCatching { incomingRingtone = userApi.settings().ringtone }
        }
    }

    // ── 音频路由(2026-08-29语音通话审计新增；2026-10-02 抽到 [CallAudioRouter] 与群通话共用)：
    // MODE_IN_COMMUNICATION + 通话焦点 + 听筒/扬声器/蓝牙路由都在 router 里；这里只处理焦点
    // 事件对本通话的影响：系统电话抢焦点时静音麦克风、GAIN 后恢复；停/补播循环提示音。
    private val audioManager: android.media.AudioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
    private var micEnabledBeforeFocusLoss = true
    // 仅系统电话抢焦点时才代为静音麦克风；记下是否由我们静音，GAIN 时只恢复自己改过的状态。
    @Volatile private var mutedForSystemCall = false
    private val audioListener = object : CallAudioRouter.Listener {
        override fun onRouteChanged(speakerOn: Boolean, bluetoothOn: Boolean, bluetoothAvailable: Boolean) {
            _state.update {
                if (it.stage == CallStage.IDLE || it.stage == CallStage.ENDED) it
                else it.copy(speakerOn = speakerOn, bluetoothOn = bluetoothOn, bluetoothAvailable = bluetoothAvailable)
            }
        }
        override fun onSystemCallInterrupted() {
            // 系统电话：静音麦克风，避免"接了系统电话，投聊还在发送声音"
            if (!mutedForSystemCall) micEnabledBeforeFocusLoss = _state.value.micEnabled
            mutedForSystemCall = true
            localAudioTrack?.setEnabled(false)
            _state.update { it.copy(micEnabled = false) }
        }
        override fun onFocusLost() {
            // B-5：停回铃等循环提示音，恢复后按阶段补播
            pauseTonesForFocusLoss()
        }
        override fun onFocusRegained() {
            if (mutedForSystemCall) {
                mutedForSystemCall = false
                localAudioTrack?.setEnabled(micEnabledBeforeFocusLoss)
                _state.update { it.copy(micEnabled = micEnabledBeforeFocusLoss) }
            }
            resumeTonesAfterFocusGain()
        }
    }

    /** B-5：焦点被抢时停循环回铃（来电铃声走铃声流、不持有通话焦点，不在此处理）。 */
    private fun pauseTonesForFocusLoss() {
        if (_state.value.stage == CallStage.OUTGOING) runCatching { toneGen?.stopTone() }
    }

    /** B-5：焦点恢复后按通话阶段补播回铃。 */
    private fun resumeTonesAfterFocusGain() {
        if (_state.value.stage == CallStage.OUTGOING) playRingbackTone()
    }

    /** 进入通话音频（幂等：已持有时不重置用户已选的扬声器/蓝牙）。 */
    private fun acquireAudioFocusAndRoute() {
        audioRouter.acquire(audioListener, _state.value.isVideo)
    }

    private fun releaseAudioFocusAndRoute() {
        mutedForSystemCall = false
        audioRouter.release(audioListener)
    }

    /** 切换扬声器/听筒(与蓝牙互斥：开扬声器会先关蓝牙路由)。 */
    fun toggleSpeaker() = audioRouter.toggleSpeaker()

    /** 切换蓝牙路由(与扬声器互斥)。仅在 state.bluetoothAvailable 时应被UI调用。 */
    fun toggleBluetooth() = audioRouter.toggleBluetooth()

    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var callTimeoutJob: Job? = null   // 主叫呼出超时:对方无应答/断线时自动收尾,防卡死"呼叫中"
    // 被叫 accept() 后的对称看门狗——接听信令丢失/SDP协商失败会永久占用
    // 麦克风/PeerConnection/前台服务,无自动恢复路径。与 callTimeoutJob 同款自守卫模式:
    // 到点检查 stage 仍是 CONNECTING 才收尾,已接通/已挂断则自然 no-op,无需额外显式取消点。
    private var connectingTimeoutJob: Job? = null
    // 来电看门狗：进入 INCOMING 后 60s 未接听/未收到 call:end（主叫断网、服务端超时事件丢失）
    // 自动收起来电界面并停铃，防止一直响。同款自守卫：到点仍是同一通 INCOMING 才收尾。
    private var incomingTimeoutJob: Job? = null
    // 前台服务是否已起：需本地媒体已建立 + RECORD_AUDIO 已授权（Android 14 未授权起 microphone
    // 类型 FGS 会抛 SecurityException）。未授权时等 CallScreen 授权回调里 ensureForegroundService()。
    @Volatile private var localMediaReady = false
    @Volatile private var foregroundStarted = false
    // 完美协商：polite 一方回滚了自己的 offer 去应答对方，应答完成后需把自己的变更（如切视频）重新 offer
    @Volatile private var renegotiateAfterRollback = false
    // ICE restart 自愈(网络切换 Wi-Fi↔4G):disconnected 3s 防抖 → restartIce → 15s 窗口 → 最多 3 次 → 挂断。
    // 信令复用现有 call:offer/answer/ice(后端纯转发零改动),对端收到 offer 走现有应答逻辑。
    private var iceRestartDebounceJob: Job? = null   // disconnected 防抖(短时探测间隙自愈)
    private var iceRestartRecoverJob: Job? = null    // restart 后等待 connected 的窗口
    private var iceRestartCount = 0                  // 连续重启次数,恢复后清零
    @Volatile private var callAttempt = 0L   // 主叫呼出序号：ack 延迟时防止旧 callId 写入新一次呼出（P2-1 @Volatile 防跨线程撕裂）
    @Volatile private var participatingCallId = "" // 仅本设备实际request/accept成功进入的通话可在重连后resume
    // Q06 全修：resume 时必须证明持有它，光凭 callId+userId 不再够（同账号旁观设备
    // 不能在断线宽限期内抢注这通电话）。request/accept 的 ack 里签发，cleanup() 清空。
    @Volatile private var participatingResumeToken: String? = null
    private var audioSource: org.webrtc.AudioSource? = null
    private var videoSource: VideoSource? = null
    private var localAudioTrack: AudioTrack? = null
    private var videoCapturer: VideoCapturer? = null
    // AUDIT P2：本端本地视频轨是否真正可用（摄像头采集成功并 addTrack）。
    // createLocalTracks 里据此判断是否需降级为纯音频（呼出转 audio 类型/接听转语音 UI）。
    private var localVideoOk = false
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
        sessionManager.onIdentityCleanup {
            if (_state.value.stage != CallStage.IDLE && _state.value.stage != CallStage.ENDED) cleanup(CallStage.ENDED)
        }
    }

    private fun ensureFactory() {
        if (factory != null) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).setFieldTrials(CALL_FIELD_TRIALS).createInitializationOptions()
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
        // 本地呼出超时:45s 内未接通(对方不接/断线,后端 timeout 不向主叫发事件)则自动挂断收尾,
        // 防止界面永远卡在"呼叫中"。接通(CONNECTED)或挂断时取消(见 cleanup / IceConnectionState)。
        // 45s = 与 Web/iOS 统一值 (2026-09-07 AUDIT 四端超时不一致项拍板)。
        callTimeoutJob?.cancel()
        callTimeoutJob = scope.launch {
            delay(45_000)
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
            // AUDIT P2：视频通话但摄像头不可用（无摄像头/被占用/权限拒）→ 本端如实降级为
            // 纯音频：状态改 audio + 按 audio 发起请求，对端按语音通话接听（不再"视频通话
            // 黑屏"静默失真）。视频权限被拒时用户可在通话中再点开摄像头重试。
            if (video && !localVideoOk) {
                Log.w(TAG, "视频采集不可用,本端降级为纯音频发起")
                _state.update { it.copy(isVideo = false) }
                audioRouter.setVideo(false)
            }
            // 本地媒体已开始采集（麦克风/摄像头）→ 起前台服务保活（RECORD_AUDIO 未授权时等授权回调再起）
            localMediaReady = true
            ensureForegroundService()
            val name = sessionManager.currentUser?.username.orEmpty()
            // ack 携带服务端生成的 callId + resumeToken；期间可能已挂断/重拨/被覆盖，仅在仍是同一通呼出时才回填（attempt 序号 + peer + stage 三重校验）
            val requestAck = socketManager.emitCallRequest(peerId, if (_state.value.isVideo) "video" else "audio", name)
            if (requestAck != null && requestAck.callId.isEmpty()) {
                // 服务端已明确拒绝（未建立通话，无需补发 call:end）：立即收尾并说明原因
                if (attempt == callAttempt && _state.value.stage == CallStage.OUTGOING) {
                    _state.update { it.copy(endMessage = callRejectMessage(requestAck.error)) }
                    cleanup(CallStage.ENDED)
                }
                return@launch
            }
            if (requestAck == null) {
                // ack 超时/socket 未连/请求被拒（P1-4）：立即收尾并提示，不再静默回铃 60s。
                // AUDIT P2（幽灵响铃）：请求可能已到达服务端而仅 ack 丢失——此时服务端
                // activeCalls 仍在响，被叫会无人接也无人拒直到 120s。若 socket 仍连着，
                // 补发一条无 callId 的 call:end 让服务端按 (我,对端) 关系清掉该通（服务端
                // CALL_REQUIRE_ID=false 走 resolvePrivateCall 兜底；请求未达服务端则无害）。
                // 仅在已连接时发：未连接时 socket.io 会把 emit 排进 sendBuffer，重连后补发的
                // 旧 end 可能误杀将来同对端的新通话。
                if (_state.value.peerId.isNotEmpty() && socketManager.isConnected()) {
                    socketManager.emitCallEnd(_state.value.peerId)
                }
                if (attempt == callAttempt && _state.value.stage == CallStage.OUTGOING) cleanup(CallStage.ENDED)
                return@launch
            }
            val callId = requestAck.callId
            if (attempt == callAttempt && _state.value.peerId == peerId && _state.value.stage != CallStage.ENDED) {
                _state.update { it.copy(callId = callId) }
                participatingCallId = callId
                participatingResumeToken = requestAck.resumeToken
            }
        }
    }

    private fun callRejectMessage(code: String?): String = when (code) {
        "CALL_BUSY" -> "对方忙线中，请稍后再拨"
        "VOICE_CALL_DISABLED" -> "语音通话功能已关闭"
        "VIDEO_CALL_DISABLED" -> "视频通话功能已关闭"
        "CALL_RATE_LIMIT" -> "操作太频繁，请稍后再拨"
        "CALL_REJECTED" -> "对方暂时无法接听"
        else -> "呼叫失败，请稍后重试"
    }

    /** 被叫接听 */
    fun accept() {
        val s = _state.value
        if (s.stage != CallStage.INCOMING) return
        stopIncomingTone()
        incomingTimeoutJob?.cancel(); incomingTimeoutJob = null
        _state.update { it.copy(stage = CallStage.CONNECTING) }
        // 响铃阶段不碰通话模式/焦点（铃声走铃声流）；接听这一刻才切通话路由。
        // 之后 createLocalTracks 里的 acquire 是幂等的，不会把用户此间切的扬声器重置。
        acquireAudioFocusAndRoute()
        // 接听后等待协商(offer/answer/ICE)超时看门狗,与主叫 45s 呼出超时对称。
        connectingTimeoutJob?.cancel()
        connectingTimeoutJob = scope.launch {
            delay(45_000)
            val st = _state.value.stage
            if (st == CallStage.CONNECTING) {
                if (_state.value.peerId.isNotEmpty()) socketManager.emitCallEnd(_state.value.peerId, _state.value.callId)
                cleanup(CallStage.ENDED)
            }
        }
        scope.launch {
            refreshIceServers()
            if (_state.value.stage == CallStage.ENDED) return@launch
            createPeerConnection()
            createLocalTracks(s.isVideo)
            // AUDIT P2：被叫接听时本端摄像头不可用 → 本端如实转语音 UI（不发视频轨）。
            // 对端仍按视频类型显示其本地画面但收不到我方视频轨，其 UI 已有"对端未开视频"
            // 的兜底渲染；通话中仍可手动再开摄像头。
            if (s.isVideo && !localVideoOk) {
                Log.w(TAG, "视频采集不可用,接听降级为纯音频")
                _state.update { it.copy(isVideo = false) }
                audioRouter.setVideo(false)
            }
            // 本地媒体已开始采集 → 起前台服务保活（RECORD_AUDIO 未授权时等授权回调再起）
            localMediaReady = true
            ensureForegroundService()
            // accept 是被叫真正首次绑定 Socket 的时刻，只有这里能拿到 resumeToken（Q06 全修）
            socketManager.emitCallResponse(s.peerId, true, s.callId, onAck = { token -> participatingResumeToken = token })
            participatingCallId = s.callId
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

    /** CallScreen 权限申请回调：补起前台服务 + 重新探测蓝牙耳机（BLUETOOTH_CONNECT 刚授予）。 */
    fun onPermissionsResult() {
        ensureForegroundService()
        audioRouter.refreshDevices()
    }

    /**
     * 起通话保活前台服务（幂等）：本地媒体已建立 + RECORD_AUDIO 已授权才起。
     * 建流时与 CallScreen 权限授权回调里各调一次——谁后到谁真正启动。
     */
    fun ensureForegroundService() {
        val st = _state.value.stage
        if (st == CallStage.IDLE || st == CallStage.ENDED || st == CallStage.INCOMING) return
        if (!localMediaReady || foregroundStarted) return
        if (!CallForegroundService.hasRecordAudioPermission(context)) {
            Log.w(TAG, "RECORD_AUDIO 未授权，暂不启动通话前台服务")
            return
        }
        foregroundStarted = true
        CallForegroundService.start(context, _state.value.isVideo)
    }

    // ── ICE restart 自愈(网络切换) ─────────────────────────────
    // disconnected 3s 防抖 → restartIce() → 15s 恢复窗口 → 未恢复重试,最多 3 次 → 挂断。
    // 信令复用现有 call:offer/answer/ice;对端收到重协商 offer 走现有应答逻辑,后端零改动。
    // 四端统一协议（2026-10-02）：只有主叫(isCaller，impolite)发起 restart offer；被叫只应答，
    // 长时间断开时按同等窗口（防抖 + 15s×3）兜底挂断——避免双方同时 restart 撞车(glare)。
    private fun tryIceRestart() {
        val pc = peerConnection ?: return
        if (!_state.value.isCaller) return
        if (iceRestartCount >= ICE_RESTART_MAX) { endCallByNetwork(); return }
        iceRestartCount++
        pc.restartIce()
        createOfferAndSend()   // restartIce() 只打标记，必须实际重协商 offer 对方才会重新打通
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

    /** 被叫：不主动 restart，等主叫的 restart offer；整段窗口后仍未恢复则挂断。 */
    private fun startCalleeRecoverWatchdog() {
        if (iceRestartRecoverJob?.isActive == true) return
        iceRestartRecoverJob = scope.launch {
            delay(ICE_RESTART_DEBOUNCE_MS + ICE_RESTART_WINDOW_MS * ICE_RESTART_MAX)
            val st = peerConnection?.iceConnectionState()
            if (st == PeerConnection.IceConnectionState.DISCONNECTED ||
                st == PeerConnection.IceConnectionState.FAILED
            ) endCallByNetwork()
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
        val wasIdle = _state.value.stage == CallStage.IDLE || _state.value.stage == CallStage.ENDED
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
        // 从空闲新进入 INCOMING 才播铃+起看门狗（重复推送/升级 callId 不重播）
        if (wasIdle) onEnterIncoming()
        else {
            // B-3：正在通话/已有来电 UI（不覆盖）时收到 FCM 来电推送 → 同样回忙线拒接，
            // 与 socket 通路 call:incoming 的 busy 语义一致；同一通的重复推送不算（只升级了 callId）
            val s = _state.value
            val sameIncoming = s.stage == CallStage.INCOMING && s.peerId == from
            if (!sameIncoming) socketManager.emitCallResponse(from, false, callId, busy = true)
        }
    }

    /** 新进入 INCOMING：播来电铃声 + 起 60s 未接听看门狗。 */
    private fun onEnterIncoming() {
        playIncomingTone()
        val attempt = callAttempt   // cleanup 会自增：期间结束过再进新来电，旧看门狗不得误杀
        incomingTimeoutJob?.cancel()
        incomingTimeoutJob = scope.launch {
            delay(INCOMING_TIMEOUT_MS)
            if (attempt == callAttempt && _state.value.stage == CallStage.INCOMING) {
                Log.w(TAG, "来电 ${INCOMING_TIMEOUT_MS / 1000}s 未接听，自动收起")
                notificationHelper.cancelCallNotification()
                cleanup(CallStage.ENDED)
            }
        }
    }

    // ── 信令处理 ───────────────────────────────────────────
    private fun observeSignaling() {
        scope.launch {
            socketManager.status.filter { it == com.touliao.app.core.realtime.SocketStatus.CONNECTED }.collect {
                val s = _state.value
                if (s.stage != CallStage.IDLE && s.stage != CallStage.ENDED &&
                    CallSignalMatcher.canResume(s.callId, participatingCallId)
                ) {
                    socketManager.emitCallResume(s.callId, participatingResumeToken)
                    // 断线期间发出的 offer（restart/切视频）可能丢了：仍停在 HAVE_LOCAL_OFFER 则重发当前本地 offer
                    val pc = peerConnection
                    val local = pc?.let { runCatching { it.localDescription }.getOrNull() }
                    if (pc != null && local != null && local.type == SessionDescription.Type.OFFER &&
                        runCatching { pc.signalingState() }.getOrNull() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER
                    ) {
                        Log.i(TAG, "信令重连：重发未应答的本地 offer")
                        socketManager.emitCallOffer(s.peerId, local.description, s.callId)
                    }
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
                    // B-3：忙线拒接带 busy=true（对齐 Web Home.jsx 语义，后端 call.js 原样转发），
                    // 主叫可区分"对方忙线中"与普通拒接；已有来电/通话 UI 保持不覆盖
                    socketManager.emitCallResponse(e.from, false, e.callId, busy = true)
                    return@collect
                }
                _state.value = CallState(
                    CallStage.INCOMING, e.from, e.callerName, isVideo = e.type == "video", isCaller = false, callId = e.callId,
                )
                onEnterIncoming()
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
                if (!s.isCaller || s.stage != CallStage.OUTGOING || s.peerId != e.from) return@collect
                // 紧急修复（2026-09-03，对齐 iOS 同一处修复）：主叫的 s.callId 要等 call:request
                // 的 ack 异步回填（startCall 里先 refreshIceServers()/建流再 emit，ack 往返还得
                // 再走一轮），被叫秒接/秒拒时这个应答完全可能在 ack 回来之前就先到——那一刻
                // s.callId 还是 ""，CallSignalMatcher 要求 eventCallId==activeCallId，非空
                // eventCallId 对上空 activeCallId 必判不匹配，于是这条应答被直接丢弃：接听方已经
                // 翻到"连接中"干等一个永远不会来的 offer。只在 s.callId 还没回填这一小段窗口内放宽成
                // "只认 peerId"（服务端 registry 早已校验过这确实是我方通话的应答，这里不是在重新
                // 开权限口子，只是本地缓存还没跟上）；callId 一旦回填，后续信令仍走 CallSignalMatcher
                // 的完整校验，不放宽。
                val idOk = s.callId.isEmpty() || CallSignalMatcher.matches(s.callId, e.callId, s.peerId, e.from)
                if (!idOk) return@collect
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
                // 完美协商（四端统一）：主叫=impolite，被叫=polite。双方同时发 offer(撞车)时
                // impolite 忽略对方 offer（对方会回滚并应答我方）；polite 先回滚自己的 offer 再应答。
                val collision = runCatching { pc.signalingState() }.getOrNull() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER
                val polite = !s.isCaller
                if (collision && !polite) {
                    Log.i(TAG, "offer 撞车：impolite 忽略对方 offer")
                    return@collect
                }
                val applyOffer = {
                    pc.setRemoteDescription(object : SimpleSdpObserver() {
                        override fun onSetSuccess() {
                            drainIce()   // 锁内置位 remoteDescSet 并排空缓存的候选
                            createAnswerAndSend()
                        }
                    }, SessionDescription(SessionDescription.Type.OFFER, e.sdp))
                }
                if (collision) {
                    Log.i(TAG, "offer 撞车：polite 回滚本地 offer 后应答")
                    renegotiateAfterRollback = true
                    pc.setLocalDescription(object : SimpleSdpObserver() {
                        override fun onSetSuccess() { applyOffer() }
                    }, SessionDescription(SessionDescription.Type.ROLLBACK, ""))
                } else {
                    applyOffer()
                }
            }
        }
        scope.launch {
            socketManager.callAnswerEvents.collect { e ->
                val s = _state.value
                if (!CallSignalMatcher.matches(s.callId, e.callId, s.peerId, e.from)) return@collect
                val pc = peerConnection ?: return@collect
                // 不在等应答（撞车后本端已回滚/重复 answer）→ 直接忽略，set 也只会失败
                if (runCatching { pc.signalingState() }.getOrNull() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
                    Log.i(TAG, "忽略非 HAVE_LOCAL_OFFER 状态下的 answer")
                    return@collect
                }
                pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() { drainIce() }   // 锁内置位 remoteDescSet 并排空
                }, SessionDescription(SessionDescription.Type.ANSWER, e.sdp))
            }
        }
        // 对方切换语音↔视频：同步 UI（媒体流由对方重协商 offer 驱动）
        scope.launch {
            socketManager.callSwitchTypeEvents.collect { e ->
                val s = _state.value
                if (!CallSignalMatcher.matches(s.callId, e.callId, s.peerId, e.from)) return@collect
                if (s.stage == CallStage.CONNECTED || s.stage == CallStage.CONNECTING) {
                    _state.update { it.copy(isVideo = e.type == "video") }
                    audioRouter.setVideo(e.type == "video")
                }
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
                // 紧急修复（2026-09-03）：同账号多端在线时，我方在另一台设备上接听/拒绝了这通
                // 来电，后端用 reason=answered_elsewhere/rejected_elsewhere 通知本设备收起来电
                // 界面——但这条通知的 from 字段是"我自己的 userId"（哪台设备做的动作），不是对方
                // 的 peerId，CallSignalMatcher 按 peerId 比对必然对不上号，导致这条通知被直接
                // 丢弃：手机上已经拒接了，另一台设备/Web 的来电界面却永远收不到通知，一直挂在
                // 那响。这类事件只会送进"我自己"的 socket 房间（服务端 socket.to(user_$userId)），
                // 能收到就已经代表"和我当前这通通话相关"，不需要也不能按 peerId 校验；只在双方
                // 都带了 callId 时才用 callId 兜底防串话。
                val isSelfDeviceSync = e.reason == "answered_elsewhere" || e.reason == "rejected_elsewhere"
                val matchesPeerCall = if (isSelfDeviceSync) {
                    val hasActiveCall = s.stage != CallStage.IDLE && s.stage != CallStage.ENDED
                    val idOk = e.callId.isEmpty() || s.callId.isEmpty() || e.callId == s.callId
                    hasActiveCall && idOk
                } else {
                    CallSignalMatcher.matchesEnd(s.callId, e.callId, s.peerId, e.from, e.reason)
                }
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
                // A-2：弱网调优 + H264 优先（setLocalDescription 前改本端 sdp）
                val tuned = SessionDescription(desc.type, tuneSdpForCall(desc.description))
                // 本地 offer 生效（进入 HAVE_LOCAL_OFFER）后再发：撞车判断/重连重发都以 signalingState 为准
                pc.setLocalDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        socketManager.emitCallOffer(_state.value.peerId, tuned.description, _state.value.callId)
                    }
                }, tuned)
            }
        }, mediaConstraints())
    }

    private fun createAnswerAndSend() {
        val pc = peerConnection ?: return
        pc.createAnswer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                // A-2：弱网调优 + H264 优先（setLocalDescription 前改本端 sdp）
                val tuned = SessionDescription(desc.type, tuneSdpForCall(desc.description))
                pc.setLocalDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        socketManager.emitCallAnswer(_state.value.peerId, tuned.description, _state.value.callId)
                        // polite 回滚过自己的 offer：应答完成回到 stable 后，把自己的变更重新 offer 一次
                        if (renegotiateAfterRollback) {
                            renegotiateAfterRollback = false
                            scope.launch { createOfferAndSend() }
                        }
                    }
                }, tuned)
            }
        }, mediaConstraints())
    }

    /** 弱网调优（2026-09-02）：Opus inband FEC + 码率上限 64kbps + 单声道。 */
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
                        startQualitySampling()
                        // N1：接通/恢复即对视频 sender 施加发送码率上限(2.5Mbps)，防止全端无约束导致模糊。
                        peerConnection?.let { capVideoBitrate(it) }
                    }
                    PeerConnection.IceConnectionState.DISCONNECTED -> scope.launch {
                        if (!_state.value.isCaller) { startCalleeRecoverWatchdog(); return@launch }
                        // 短时探测间隙(<3s 通常自愈,锁屏/后台):防抖后再重启,避免无谓重协商
                        iceRestartDebounceJob?.cancel()
                        iceRestartDebounceJob = scope.launch {
                            delay(ICE_RESTART_DEBOUNCE_MS)
                            tryIceRestart()
                        }
                    }
                    PeerConnection.IceConnectionState.FAILED -> scope.launch {
                        // 必须异步：此回调在 WebRTC 信令线程，同步 cleanup 里 pc.close()/dispose() 会死锁/崩溃
                        if (!_state.value.isCaller) { startCalleeRecoverWatchdog(); return@launch }
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

    /** N1：视频发送码率上限 2.5Mbps（全端一致），仅影响 video sender；异常静默不影响通话。 */
    private fun capVideoBitrate(pc: PeerConnection) {
        runCatching {
            pc.getSenders().filter { it.track()?.kind() == "video" }.forEach { sender ->
                val params = sender.parameters
                params.encodings?.firstOrNull()?.maxBitrateBps = 2_500_000
                sender.parameters = params
            }
        }
    }

    private fun createLocalTracks(video: Boolean) {
        val f = factory ?: return
        val pc = peerConnection ?: return
        acquireAudioFocusAndRoute()   // 幂等：startCall/accept 已获取时不重置路由
        localVideoOk = false
        // 音频
        audioSource = f.createAudioSource(MediaConstraints())
        localAudioTrack = f.createAudioTrack("audio0", audioSource).apply { setEnabled(true) }
        pc.addTrack(localAudioTrack, listOf(STREAM_ID))
        // 视频：摄像头不可用/启动失败 → 不 abort（音频轨已加），降级为纯音频由调用方判定
        // （呼出侧改发 audio 请求；接听侧保持音频应答）。静默继续只会让对端/本端 UI 误以为
        // 有视频轨——黑屏假视频比明示的纯音频更糟。
        if (video) {
            val capturer = createCameraCapturer()
            if (capturer == null) {
                Log.w(TAG, "视频采集不可用(无摄像头/被占用/权限拒):本端按纯音频继续")
                return
            }
            videoCapturer = capturer
            surfaceHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
            videoSource = f.createVideoSource(false)
            capturer.initialize(surfaceHelper, context, videoSource!!.capturerObserver)
            runCatching { capturer.startCapture(1280, 720, 30) }
                .onFailure { e -> Log.w(TAG, "视频采集启动失败: ${e.message}") }
            localVideoTrack = f.createVideoTrack("video0", videoSource).apply { setEnabled(true) }
            pc.addTrack(localVideoTrack, listOf(STREAM_ID))
            localVideoOk = true
        }
    }

    // ── 通话质量指示（2026-09-02）：getStats 2s 采样 RTT/丢包率 → 优/中/差 ──
    private var qualityJob: Job? = null

    private fun startQualitySampling() {
        qualityJob?.cancel()
        qualityJob = scope.launch {
            while (isActive) {
                sampleQuality()
                delay(2000)
            }
        }
    }

    private fun sampleQuality() {
        val pc = peerConnection ?: return
        pc.getStats(object : RTCStatsCollectorCallback {
            override fun onStatsDelivered(report: RTCStatsReport) {
                var rtt: Double? = null
                var lost = 0L; var received = 0L
                for (s in report.statsMap.values) {
                    val m = s.members
                    if (s.type == "candidate-pair" && m["nominated"] == true && m["state"] == "succeeded") {
                        (m["currentRoundTripTime"] as? Double)?.let { rtt = it * 1000 }
                    }
                    if (s.type == "inbound-rtp" && m["kind"] == "audio") {
                        lost += (m["packetsLost"] as? Long) ?: 0L
                        received += (m["packetsReceived"] as? Long) ?: 0L
                    }
                }
                val lossRate = if (received + lost > 0) lost.toDouble() / (received + lost) else 0.0
                val r = rtt   // 局部快照：lambda 捕获的可变变量不能 smart cast
                val q = when {
                    r != null && r >= 500 -> "poor"
                    r != null && r >= 200 -> "medium"
                    lossRate >= 0.08 -> "poor"
                    lossRate >= 0.02 -> "medium"
                    else -> "good"
                }
                if (_state.value.callQuality != q) _state.update { it.copy(callQuality = q) }
            }
        })
    }

    private fun createCameraCapturer(): VideoCapturer? {
        val enumerator = Camera2Enumerator(context)
        val names = enumerator.deviceNames
        names.firstOrNull { enumerator.isFrontFacing(it) }?.let { return enumerator.createCapturer(it, null) }
        names.firstOrNull()?.let { return enumerator.createCapturer(it, null) }
        return null
    }

    /**
     * 通话中切换语音↔视频（2026-09-02）：补/删视频轨 + 重协商 offer + call:switch-type 告知对方。
     * 对方由重协商 offer 驱动媒体流变化，switch-type 仅用于同步 UI（isVideo）。
     */
    fun toggleVideo() {
        val s = _state.value
        val pc = peerConnection ?: return
        if (s.stage != CallStage.CONNECTED) return
        val nextVideo = !s.isVideo
        scope.launch {
            try {
                if (nextVideo) {
                    // 语音→视频：启动摄像头采集并加轨
                    if (localVideoTrack == null) {
                        val capturer = createCameraCapturer()
                        if (capturer == null) { Log.w(TAG, "切换视频失败:无可用摄像头"); return@launch }
                        val f = factory ?: return@launch
                        videoCapturer = capturer
                        surfaceHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
                        videoSource = f.createVideoSource(false)
                        capturer.initialize(surfaceHelper, context, videoSource!!.capturerObserver)
                        runCatching { capturer.startCapture(1280, 720, 30) }
                            .onFailure { e -> Log.w(TAG, "视频采集启动失败: ${e.message}") }
                        localVideoTrack = f.createVideoTrack("video0", videoSource).apply { setEnabled(true) }
                        pc.addTrack(localVideoTrack, listOf(STREAM_ID))
                    } else {
                        runCatching { pc.addTrack(localVideoTrack, listOf(STREAM_ID)) }   // 可能曾被 removeTrack
                        runCatching { localVideoTrack?.setEnabled(true) }
                        runCatching { videoCapturer?.startCapture(1280, 720, 30) }
                    }
                    capVideoBitrate(pc)   // N1：补轨成功后立即施加发送码率上限
                } else {
                    // 视频→语音：停采集 + 移除视频轨（track 引用保留，切回可复用）
                    pc.getSenders().filter { it.track()?.kind() == "video" }.forEach { sender ->
                        runCatching { pc.removeTrack(sender) }
                    }
                    runCatching { videoCapturer?.stopCapture() }
                    runCatching { localVideoTrack?.setEnabled(false) }
                }
                createOfferAndSend()   // 重协商（含 SDP 弱网调优）
                socketManager.emitCallSwitchType(s.peerId, if (nextVideo) "video" else "audio", s.callId)
                _state.update { it.copy(isVideo = nextVideo) }
                audioRouter.setVideo(nextVideo)
            } catch (e: Exception) {
                Log.w(TAG, "切换通话类型失败: ${e.message}")
            }
        }
    }

    // ── 清理 ──────────────────────────────────────────────
    private fun cleanup(finalStage: CallStage) {
        callAttempt++
        participatingCallId = ""
        participatingResumeToken = null
        stopIncomingTone()                                // 停来电铃声（接听/拒接/挂断/清理）
        qualityJob?.cancel(); qualityJob = null          // 停质量采样
        releaseTone()                                     // 停回铃/接通音并释放 ToneGenerator
        releaseAudioFocusAndRoute()                        // 恢复系统默认音频模式/释放焦点，防止占用
        callTimeoutJob?.cancel(); callTimeoutJob = null   // 接通/挂断/被拒 → 取消呼出超时
        incomingTimeoutJob?.cancel(); incomingTimeoutJob = null   // 取消来电未接听看门狗
        connectingTimeoutJob?.cancel(); connectingTimeoutJob = null   // 同上，取消接听协商超时
        iceRestartDebounceJob?.cancel(); iceRestartDebounceJob = null
        iceRestartRecoverJob?.cancel(); iceRestartRecoverJob = null
        localMediaReady = false
        renegotiateAfterRollback = false
        if (foregroundStarted) {
            foregroundStarted = false
            CallForegroundService.stop(context)           // 停前台服务
        }
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

    // ── 来电铃声（2026-09-02：可自定义，key 来自 user_settings.ringtone）────
    // ToneGenerator 预设映射：classic=标准铃声 / dual=急促双响 / triple=短促三连 / soft=低音量长音。
    // 与 Web callTones / iOS CallTonePlayer 的四种 key 一一对应。
    @Volatile
    var incomingRingtone: String = "classic"

    private var incomingToneJob: kotlinx.coroutines.Job? = null

    private fun incomingTonePreset(key: String): List<Pair<Int, Long>> = when (key) {
        "dual"   -> listOf(android.media.ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD to 800L, android.media.ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD to 800L)
        "triple" -> listOf(android.media.ToneGenerator.TONE_PROP_BEEP to 250L, android.media.ToneGenerator.TONE_PROP_BEEP to 250L, android.media.ToneGenerator.TONE_PROP_BEEP to 250L)
        "soft"   -> listOf(android.media.ToneGenerator.TONE_PROP_BEEP2 to 1500L)
        else     -> listOf(android.media.ToneGenerator.TONE_SUP_RINGTONE to 1200L)
    }

    // 来电铃声走铃声流（STREAM_RING）独立的 ToneGenerator：2026-10-02 前与回铃共用 STREAM_VOICE_CALL，
    // 响铃阶段还会切 MODE_IN_COMMUNICATION + 抢通话焦点——结果语音来电铃声从听筒出（贴耳才听得见），
    // 静音/振动模式下照样响，还会打断正在播放的音乐。现在响铃阶段不碰通话模式/焦点，接听后再切通话路由。
    @Volatile
    private var ringToneGen: android.media.ToneGenerator? = null
    private var vibrating = false

    /** 来电循环铃声（进入 INCOMING 时调用；幂等）。遵从系统静音/振动模式。 */
    @Synchronized
    private fun playIncomingTone() {
        stopIncomingTone()
        val ringerMode = runCatching { audioManager.ringerMode }.getOrDefault(android.media.AudioManager.RINGER_MODE_NORMAL)
        if (ringerMode == android.media.AudioManager.RINGER_MODE_SILENT) return
        startRingVibration()
        if (ringerMode == android.media.AudioManager.RINGER_MODE_VIBRATE) return
        if (ringToneGen == null) {
            ringToneGen = runCatching {
                android.media.ToneGenerator(android.media.AudioManager.STREAM_RING, 80)
            }.onFailure { e ->
                android.util.Log.w(TAG, "铃声 ToneGenerator 创建失败: ${e.message}")
            }.getOrNull()
        }
        val gen = ringToneGen ?: return
        val preset = incomingTonePreset(incomingRingtone)
        incomingToneJob = scope.launch {
            while (isActive) {
                for ((tone, dur) in preset) {
                    if (!isActive) break
                    runCatching { gen.startTone(tone, dur.toInt()) }
                        .onFailure { e -> android.util.Log.w(TAG, "来电铃声播放失败: ${e.message}") }
                    delay(dur + 320L)
                }
                delay(1500)
            }
        }
    }

    /** 停止来电铃声与振动（接听/拒接/清理时调用；幂等）。 */
    @Synchronized
    private fun stopIncomingTone() {
        incomingToneJob?.cancel(); incomingToneJob = null
        runCatching { ringToneGen?.stopTone() }
        runCatching { ringToneGen?.release() }
        ringToneGen = null
        stopRingVibration()
    }

    private fun vibrator(): android.os.Vibrator? =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
        }

    /** 来电振动（响铃/振动模式下；静音模式不振）。节奏 1s 振 / 1s 停，循环。 */
    private fun startRingVibration() {
        val v = vibrator() ?: return
        if (!v.hasVibrator()) return
        val pattern = longArrayOf(0L, 1000L, 1000L)
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                v.vibrate(android.os.VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(pattern, 0)
            }
            vibrating = true
        }.onFailure { e -> android.util.Log.w(TAG, "来电振动失败: ${e.message}") }
    }

    private fun stopRingVibration() {
        if (!vibrating) return
        vibrating = false
        runCatching { vibrator()?.cancel() }
    }

    private companion object {
        const val STREAM_ID = "stream0"
        const val TAG = "CallManager"
        // ICE restart 参数(与四端统一):防抖 3s / 恢复窗口 15s / 最大 3 次
        const val ICE_RESTART_DEBOUNCE_MS = 3000L
        const val ICE_RESTART_WINDOW_MS = 15000L
        const val ICE_RESTART_MAX = 3
        const val INCOMING_TIMEOUT_MS = 60_000L   // 来电未接听看门狗
    }
}

/** SdpObserver 默认空实现，按需重写 */
open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) { Log.w("CallManager", "sdp create fail: $error") }
    override fun onSetFailure(error: String?) { Log.w("CallManager", "sdp set fail: $error") }
}
