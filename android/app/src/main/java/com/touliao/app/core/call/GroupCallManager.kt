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
import org.webrtc.AudioSource
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
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import javax.inject.Inject
import javax.inject.Singleton

enum class GroupCallStage { IDLE, CONNECTING, CONNECTED, ENDED }

data class GroupCallState(
    val stage: GroupCallStage = GroupCallStage.IDLE,
    val callId: String = "",
    val conversationId: String = "",
    val isVideo: Boolean = false,
    val participants: List<String> = emptyList(), // 远端成员 id（不含自己）
    val micEnabled: Boolean = true,
    val cameraEnabled: Boolean = true,
    val connectedAt: Long = 0,        // 接通时刻(elapsedRealtime ms)，用于通话计时
    // 2026-10-02：群通话补音频路由（此前完全没有扬声器开关/通话模式），语义同 1v1 CallState
    val speakerOn: Boolean = false,
    val bluetoothOn: Boolean = false,
    val bluetoothAvailable: Boolean = false,
)

/**
 * 群音视频通话（mesh）。信令协议见 backend-v2/docs/GROUP_CALL.md。
 * 与 [CallManager] 各自独立；本地音视频轨只建一份，加入到每条 PeerConnection。
 * 防 glare：新加入者只 answer；既有成员收到 peer_joined 才向其 createOffer。
 * 重协商撞车（四端统一，2026-10-02）：每对 peer 按 userId 字符串比较，较小一方 impolite 且
 * 负责 ICE restart，较大一方 polite（撞车时回滚自己的 offer 再应答，不主动 restart）。
 */
@Singleton
class GroupCallManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val socketManager: SocketManager,
    private val sessionManager: SessionManager,
    private val turnApi: com.touliao.app.data.api.TurnApi,
    private val audioRouter: CallAudioRouter,
    @AppScope private val scope: CoroutineScope,
) {
    val eglBase: EglBase = EglBase.create()

    private var factory: PeerConnectionFactory? = null
    private var audioSource: AudioSource? = null
    private var localAudioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var videoCapturer: VideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    var localVideoTrack: VideoTrack? = null
        private set

    // iceLock：ICE 事件在协程线程读写 pendingIce/remoteDescSet，而 onSetSuccess/drainIce 在 WebRTC
    // 自有线程回调。二者不互斥则存在竞态：ICE 读到 remoteDescSet==false，此刻 onSetSuccess 另一线程
    // 置位并排空空队列，ICE 再把候选压进 pendingIce → 永不排空 → 该 peer 连接卡住。并发迭代还会 CME。
    private data class Peer(
        val pc: PeerConnection,
        var remoteDescSet: Boolean = false,
        val pendingIce: MutableList<IceCandidate> = mutableListOf(),
        // ICE restart 自愈(网络切换):每 peer 独立计数与定时器,策略与 1:1 统一
        var iceRestartCount: Int = 0,
        var iceRestartDebounceJob: Job? = null,
        var iceRestartRecoverJob: Job? = null,
        val iceLock: Any = Any(),
    )
    // peers 被信令协程(Default 多线程)、WebRTC Observer 回调线程、定时器同时访问：一律经 peersLock，
    // 迭代用快照（保留插入顺序 → 宫格顺序稳定，所以不换 ConcurrentHashMap）。
    private val peersLock = Any()
    private val peers = LinkedHashMap<String, Peer>()
    private fun peerOf(peerId: String): Peer? = synchronized(peersLock) { peers[peerId] }
    private fun peerIds(): List<String> = synchronized(peersLock) { peers.keys.toList() }
    private fun peerList(): List<Peer> = synchronized(peersLock) { peers.values.toList() }

    // 前台服务：本地媒体已建立 + RECORD_AUDIO 已授权才起（同 CallManager.ensureForegroundService）
    @Volatile private var localMediaReady = false
    @Volatile private var foregroundStarted = false

    // ── 音频路由/焦点（共享 [CallAudioRouter]）：系统电话抢焦点时静音麦克风，GAIN 后恢复 ──
    private var micEnabledBeforeFocusLoss = true
    @Volatile private var mutedForSystemCall = false
    private val audioListener = object : CallAudioRouter.Listener {
        override fun onRouteChanged(speakerOn: Boolean, bluetoothOn: Boolean, bluetoothAvailable: Boolean) {
            _state.update {
                if (it.stage == GroupCallStage.IDLE || it.stage == GroupCallStage.ENDED) it
                else it.copy(speakerOn = speakerOn, bluetoothOn = bluetoothOn, bluetoothAvailable = bluetoothAvailable)
            }
        }
        override fun onSystemCallInterrupted() {
            if (!mutedForSystemCall) micEnabledBeforeFocusLoss = _state.value.micEnabled
            mutedForSystemCall = true
            localAudioTrack?.setEnabled(false)
            _state.update { it.copy(micEnabled = false) }
        }
        override fun onFocusRegained() {
            if (mutedForSystemCall) {
                mutedForSystemCall = false
                localAudioTrack?.setEnabled(micEnabledBeforeFocusLoss)
                _state.update { it.copy(micEnabled = micEnabledBeforeFocusLoss) }
            }
        }
    }

    /** 本端 userId（impolite/polite 判定用）。 */
    private fun myUserId(): String = sessionManager.currentUser?.id.orEmpty()

    /** 与该 peer 之间本端是否 impolite（userId 字符串较小一方）：负责 ICE restart，撞车时忽略对方 offer。 */
    private fun isImpoliteTo(peerId: String): Boolean = myUserId() < peerId

    private val _state = MutableStateFlow(GroupCallState())
    val state: StateFlow<GroupCallState> = _state.asStateFlow()

    // 远端视频轨：peerId -> VideoTrack，供 UI 宫格渲染
    private val _remoteTracks = MutableStateFlow<Map<String, VideoTrack>>(emptyMap())
    val remoteTracks: StateFlow<Map<String, VideoTrack>> = _remoteTracks.asStateFlow()

    private val fallbackIceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
    )
    @Volatile private var iceServers: List<PeerConnection.IceServer> = fallbackIceServers
    @Volatile private var busyElsewhereCallId: String = ""
    @Volatile private var participatingCallId: String = ""
    // Q06 全修：group_call:resume 必须证明持有它，光凭 callId+userId 不再够（同账号
    // 旁观设备不能在断线宽限期内抢注）。group_call:started/peers 里签发，cleanup() 清空。
    @Volatile private var participatingResumeToken: String? = null
    @Volatile private var callAttempt = 0L

    init {
        ensureFactory()
        observeSignaling()
        sessionManager.onIdentityCleanup {
            if (_state.value.stage != GroupCallStage.IDLE && _state.value.stage != GroupCallStage.ENDED) cleanup()
            busyElsewhereCallId = ""
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
            Log.w(TAG, "refreshIceServers failed, fallback STUN", e)
        }
    }

    // ── 对外动作 ───────────────────────────────────────────
    /** 发起群通话 */
    fun start(conversationId: String, video: Boolean) {
        if (busyElsewhereCallId.isNotEmpty()) return
        if (_state.value.stage != GroupCallStage.IDLE && _state.value.stage != GroupCallStage.ENDED) return
        val attempt = ++callAttempt
        _state.value = GroupCallState(GroupCallStage.CONNECTING, conversationId = conversationId, isVideo = video)
        // 进入群通话即切通话音频：群视频默认扬声器、群语音默认听筒，有蓝牙耳机优先蓝牙
        audioRouter.acquire(audioListener, video)
        scope.launch {
            refreshIceServers()
            if (attempt != callAttempt || _state.value.stage == GroupCallStage.ENDED) return@launch
            createLocalMedia(video)
            socketManager.emitGroupCallStart(conversationId, if (video) "video" else "audio")
        }
    }

    /** 加入已有群通话 */
    fun join(callId: String, conversationId: String, video: Boolean) {
        if (_state.value.stage != GroupCallStage.IDLE && _state.value.stage != GroupCallStage.ENDED) return
        val attempt = ++callAttempt
        _state.value = GroupCallState(GroupCallStage.CONNECTING, callId, conversationId, isVideo = video)
        audioRouter.acquire(audioListener, video)
        scope.launch {
            refreshIceServers()
            if (attempt != callAttempt || _state.value.stage == GroupCallStage.ENDED) return@launch
            createLocalMedia(video)
            socketManager.emitGroupCallJoin(callId)
        }
    }

    /** 挂断/离开 */
    fun hangup() {
        val cid = _state.value.callId
        if (cid.isNotEmpty()) socketManager.emitGroupCallLeave(cid)
        cleanup()
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

    fun switchCamera() { (videoCapturer as? CameraVideoCapturer)?.switchCamera(null) }

    fun toggleSpeaker() = audioRouter.toggleSpeaker()

    fun toggleBluetooth() = audioRouter.toggleBluetooth()

    /** GroupCallScreen 权限申请回调：补起前台服务 + 重新探测蓝牙耳机。 */
    fun onPermissionsResult() {
        ensureForegroundService()
        audioRouter.refreshDevices()
    }

    /** 起通话保活前台服务（幂等）：建流后与 GroupCallScreen 授权回调里各调一次，谁后到谁真正启动。 */
    fun ensureForegroundService() {
        val st = _state.value.stage
        if (st == GroupCallStage.IDLE || st == GroupCallStage.ENDED) return
        if (!localMediaReady || foregroundStarted) return
        if (!CallForegroundService.hasRecordAudioPermission(context)) {
            Log.w(TAG, "RECORD_AUDIO 未授权，暂不启动通话前台服务")
            return
        }
        foregroundStarted = true
        CallForegroundService.start(context, _state.value.isVideo)
    }

    fun consumeEnded() {
        if (_state.value.stage == GroupCallStage.ENDED) _state.value = GroupCallState()
    }

    // ── 信令处理 ───────────────────────────────────────────
    private fun observeSignaling() {
        scope.launch {
            socketManager.callOutgoingEvents.collect { busyElsewhereCallId = it.callId }
        }
        scope.launch {
            socketManager.callEndEvents.collect { if (it.callId.isEmpty() || it.callId == busyElsewhereCallId) busyElsewhereCallId = "" }
        }
        scope.launch {
            socketManager.status.filter { it == com.touliao.app.core.realtime.SocketStatus.CONNECTED }.collect {
                val cid = _state.value.callId
                if (_state.value.stage != GroupCallStage.IDLE && _state.value.stage != GroupCallStage.ENDED &&
                    CallSignalMatcher.canResume(cid, participatingCallId)
                ) {
                    socketManager.emitGroupCallResume(cid, participatingResumeToken)
                    // 断线期间发出的 offer 可能丢了：仍停在 HAVE_LOCAL_OFFER 的 peer 重发当前本地 offer
                    synchronized(peersLock) { peers.entries.toList() }.forEach { (pid, peer) ->
                        val local = runCatching { peer.pc.localDescription }.getOrNull()
                        if (local != null && local.type == SessionDescription.Type.OFFER &&
                            runCatching { peer.pc.signalingState() }.getOrNull() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER
                        ) {
                            socketManager.emitGroupCallOffer(cid, pid, local.description)
                        }
                    }
                }
            }
        }
        scope.launch {
            socketManager.groupCallStartedEvents.collect { e ->
                if (_state.value.stage == GroupCallStage.ENDED) return@collect
                participatingCallId = e.callId
                participatingResumeToken = e.resumeToken
                _state.update { it.copy(stage = GroupCallStage.CONNECTED, callId = e.callId, connectedAt = if (it.connectedAt == 0L) android.os.SystemClock.elapsedRealtime() else it.connectedAt) }
            }
        }
        scope.launch {
            socketManager.groupCallPeersEvents.collect { e ->
                if (_state.value.callId.isNotEmpty() && e.callId != _state.value.callId) return@collect
                participatingCallId = e.callId
                participatingResumeToken = e.resumeToken
                _state.update { it.copy(stage = GroupCallStage.CONNECTED, callId = e.callId, connectedAt = if (it.connectedAt == 0L) android.os.SystemClock.elapsedRealtime() else it.connectedAt) }
                // 作为 answerer：为既有成员预建 PC，等其 offer
                e.peers.forEach { pid -> peerFor(pid) }
                _state.update { it.copy(participants = peerIds()) }
            }
        }
        scope.launch {
            socketManager.groupCallPeerJoinedEvents.collect { e ->
                if (e.callId != _state.value.callId) return@collect
                val peer = peerFor(e.userId)
                _state.update { it.copy(participants = peerIds()) }
                // 既有成员向新 peer 发 offer
                sendOffer(e.userId, peer)
            }
        }
        scope.launch {
            socketManager.groupCallOfferEvents.collect { e ->
                if (e.callId != _state.value.callId) return@collect
                val peer = peerFor(e.from)
                _state.update { it.copy(participants = peerIds()) }
                // 完美协商：撞车(本端也在 HAVE_LOCAL_OFFER)时 impolite 忽略，polite 回滚后应答
                val collision = runCatching { peer.pc.signalingState() }.getOrNull() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER
                if (collision && isImpoliteTo(e.from)) {
                    Log.i(TAG, "offer 撞车(${e.from})：impolite 忽略对方 offer")
                    return@collect
                }
                val applyOffer = {
                    peer.pc.setRemoteDescription(object : SimpleSdpObserver() {
                        override fun onSetSuccess() {
                            drainIce(e.from)   // 锁内置位 remoteDescSet 并排空缓存候选
                            peer.pc.createAnswer(object : SimpleSdpObserver() {
                                override fun onCreateSuccess(desc: SessionDescription) {
                                    // A-2：弱网调优 + H264 优先（setLocalDescription 前改本端 sdp）
                                    val tuned = SessionDescription(desc.type, tuneSdpForCall(desc.description))
                                    peer.pc.setLocalDescription(object : SimpleSdpObserver() {
                                        override fun onSetSuccess() {
                                            socketManager.emitGroupCallAnswer(_state.value.callId, e.from, tuned.description)
                                        }
                                    }, tuned)
                                }
                            }, mediaConstraints())
                        }
                    }, SessionDescription(SessionDescription.Type.OFFER, e.sdp))
                }
                if (collision) {
                    Log.i(TAG, "offer 撞车(${e.from})：polite 回滚本地 offer 后应答")
                    peer.pc.setLocalDescription(object : SimpleSdpObserver() {
                        override fun onSetSuccess() { applyOffer() }
                    }, SessionDescription(SessionDescription.Type.ROLLBACK, ""))
                } else {
                    applyOffer()
                }
            }
        }
        scope.launch {
            socketManager.groupCallAnswerEvents.collect { e ->
                if (e.callId != _state.value.callId) return@collect
                val peer = peerOf(e.from) ?: return@collect
                // 不在等应答（撞车后本端已回滚/重复 answer）→ 直接忽略，不再 removePeer
                if (runCatching { peer.pc.signalingState() }.getOrNull() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
                    Log.i(TAG, "忽略非 HAVE_LOCAL_OFFER 状态下来自 ${e.from} 的 answer")
                    return@collect
                }
                peer.pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() { drainIce(e.from) }   // 锁内置位 remoteDescSet 并排空
                }, SessionDescription(SessionDescription.Type.ANSWER, e.sdp))
            }
        }
        scope.launch {
            socketManager.groupCallIceEvents.collect { e ->
                if (e.callId != _state.value.callId) return@collect
                val peer = peerOf(e.from) ?: return@collect
                val cand = IceCandidate(e.sdpMid, e.sdpMLineIndex, e.candidate)
                // 锁内「判断 + 加入/直排」原子化：与 drainIce 的「置位 + 排空」互斥，杜绝候选丢失竞态。
                synchronized(peer.iceLock) {
                    if (peer.remoteDescSet) peer.pc.addIceCandidate(cand) else peer.pendingIce.add(cand)
                }
            }
        }
        scope.launch {
            socketManager.groupCallPeerLeftEvents.collect { e ->
                if (e.callId == _state.value.callId) removePeer(e.userId)
            }
        }
        scope.launch {
            socketManager.groupCallErrorEvents.collect { e ->
                Log.w(TAG, "group call error: ${e.reason}")
                if (_state.value.stage != GroupCallStage.CONNECTED) cleanup()
            }
        }
        scope.launch {
            // 服务端强制结束（如超过时长上限）：无条件结束本地通话并回收资源
            socketManager.groupCallEndedEvents.collect { e ->
                if (_state.value.stage == GroupCallStage.IDLE ||
                    !CallSignalMatcher.canResume(_state.value.callId, e.callId)
                ) return@collect
                Log.w(TAG, "group call ended by server: ${e.reason}")
                cleanup()
            }
        }
    }

    // 锁内「置位 remoteDescSet + 排空缓存候选」原子化：与 ICE 收集器的「判断 + 加入」互斥。
    private fun drainIce(peerId: String) {
        val peer = peerOf(peerId) ?: return
        synchronized(peer.iceLock) {
            peer.remoteDescSet = true
            peer.pendingIce.forEach { peer.pc.addIceCandidate(it) }
            peer.pendingIce.clear()
        }
    }

    // ── WebRTC ───────────────────────────────────────────
    private fun createLocalMedia(video: Boolean) {
        val f = factory ?: return
        audioSource = f.createAudioSource(MediaConstraints())
        localAudioTrack = f.createAudioTrack("g_audio", audioSource).apply { setEnabled(true) }
        // 本地媒体已开始采集 → 起前台服务保活（RECORD_AUDIO 未授权时等授权回调再起）
        localMediaReady = true
        ensureForegroundService()
        if (video) {
            val capturer = createCameraCapturer() ?: return
            videoCapturer = capturer
            surfaceHelper = SurfaceTextureHelper.create("GCCapture", eglBase.eglBaseContext)
            videoSource = f.createVideoSource(false)
            capturer.initialize(surfaceHelper, context, videoSource!!.capturerObserver)
            runCatching { capturer.startCapture(1280, 720, 30) }
            localVideoTrack = f.createVideoTrack("g_video", videoSource).apply { setEnabled(true) }
        }
    }

    private fun createCameraCapturer(): VideoCapturer? {
        val enumerator = Camera2Enumerator(context)
        val names = enumerator.deviceNames
        names.firstOrNull { enumerator.isFrontFacing(it) }?.let { return enumerator.createCapturer(it, null) }
        names.firstOrNull()?.let { return enumerator.createCapturer(it, null) }
        return null
    }

    /**
     * N1+A-3：视频发送参数。maxBps=发送码率上限（群 mesh 按已连接人数传入，见
     * [reapplyGroupCaps]）；degrade=true 时对 encodings[0] 叠加 2 倍降分辨率压 CPU/带宽，
     * false 时显式清掉该字段（人数回落恢复全分辨率）。仅影响 video sender，异常静默。
     * （Android 端 1v1 CallManager 的 capVideoBitrate 固定 2.5M 不降档，与此互不影响。）
     */
    private fun capVideoBitrate(pc: PeerConnection, maxBps: Int = 2_500_000, degrade: Boolean = false) {
        runCatching {
            pc.getSenders().filter { it.track()?.kind() == "video" }.forEach { sender ->
                val params = sender.parameters
                params.encodings?.firstOrNull()?.let { enc ->
                    enc.maxBitrateBps = maxBps
                    enc.scaleResolutionDownBy = if (degrade) 2.0 else null
                }
                sender.parameters = params
            }
        }
    }

    // A-3（2026-09-05）：mesh 群通话按当前已连接 peer 数 n 对全部已连接 pc 重放视频码率/
    // 降档——N 路同时编码共享同一份 CPU/上行带宽，人越多每路预算必须越低：
    //   ≤2（与 1v1 默认一致）2.5M / 3 人 1.6M / 4 人 1.2M / ≥5 人 1.0M；
    //   n≥4 叠加 scaleResolutionDownBy=2 降编码负载，人数回落靠 degrade=false 清掉恢复。
    // 触发点：任一 peer ICE connected / removePeer。只对已连接的 pc 施加——未协商完的
    // sender 上设参数可能失败，且连上才真正占编码资源。
    private fun reapplyGroupCaps() {
        fun connected(p: Peer) = p.pc.iceConnectionState().let {
            it == PeerConnection.IceConnectionState.CONNECTED || it == PeerConnection.IceConnectionState.COMPLETED
        }
        val all = peerList()
        val n = all.count { connected(it) }
        val maxBps = when {
            n <= 2 -> 2_500_000
            n == 3 -> 1_600_000
            n == 4 -> 1_200_000
            else -> 1_000_000
        }
        val degrade = n >= 4
        all.filter { connected(it) }.forEach { capVideoBitrate(it.pc, maxBps, degrade) }
    }

    // 为某 peer 建立 PeerConnection（含本地轨）。幂等；查找+创建在 peersLock 内，防两条信令协程并发各建一条。
    private fun peerFor(peerId: String): Peer = synchronized(peersLock) {
        peers[peerId]?.let { return it }
        val f = factory!!
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val pc = f.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                socketManager.emitGroupCallIce(_state.value.callId, peerId, candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)
            }
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>?) {
                (receiver.track() as? VideoTrack)?.let { vt ->
                    _remoteTracks.update { it + (peerId to vt) }
                }
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                // 本回调在 WebRTC 信令线程：其中不得同步 close()/dispose() 任何 pc（会死锁/崩溃），
                // 也不碰 peers 结构，统一切到 scope 处理。
                scope.launch { handleIceState(peerId, state) }
            }
            override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
            override fun onIceConnectionReceivingChange(p0: Boolean) {}
            override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
            override fun onAddStream(p0: MediaStream?) {}
            override fun onRemoveStream(p0: MediaStream?) {}
            override fun onDataChannel(p0: org.webrtc.DataChannel?) {}
            override fun onRenegotiationNeeded() {}
        })!!
        localAudioTrack?.let { pc.addTrack(it, listOf(STREAM_ID)) }
        localVideoTrack?.let { pc.addTrack(it, listOf(STREAM_ID)) }
        val peer = Peer(pc)
        peers[peerId] = peer
        peer
    }

    private fun handleIceState(peerId: String, state: PeerConnection.IceConnectionState) {
        val peer = peerOf(peerId) ?: return
        when (state) {
            PeerConnection.IceConnectionState.CONNECTED,
            PeerConnection.IceConnectionState.COMPLETED -> {
                // restart 后恢复:清定时器 + 计数清零(可反复自愈)
                peer.iceRestartDebounceJob?.cancel(); peer.iceRestartDebounceJob = null
                peer.iceRestartRecoverJob?.cancel(); peer.iceRestartRecoverJob = null
                peer.iceRestartCount = 0
                // A-3：本 pc 刚转 connected → 按最新已连接人数对全部已连接 pc（含本条）重放码率/降档
                reapplyGroupCaps()
            }
            PeerConnection.IceConnectionState.DISCONNECTED -> {
                if (!isImpoliteTo(peerId)) { startPoliteRecoverWatchdog(peerId, peer); return }
                // 短时探测间隙:3s 防抖后再重启,避免无谓重协商
                peer.iceRestartDebounceJob?.cancel()
                peer.iceRestartDebounceJob = scope.launch {
                    delay(ICE_RESTART_DEBOUNCE_MS)
                    tryPeerRestart(peerId)
                }
            }
            PeerConnection.IceConnectionState.FAILED -> {
                if (!isImpoliteTo(peerId)) { startPoliteRecoverWatchdog(peerId, peer); return }
                // 首次 failed:给一次 restart 机会;已重启过且非窗口期 → 移除
                if (peer.iceRestartCount == 0 && peer.iceRestartRecoverJob == null) tryPeerRestart(peerId)
                else if (peer.iceRestartRecoverJob == null) removePeer(peerId)
            }
            // CLOSED 只会是我们自己 close() 触发（removePeer/cleanup 已在处理），不再递归 removePeer
            PeerConnection.IceConnectionState.CLOSED -> {}
            else -> {}
        }
    }

    /** polite 一方不主动 restart，等对端（impolite）的 restart offer；整段窗口后仍未恢复则移除该 peer。 */
    private fun startPoliteRecoverWatchdog(peerId: String, peer: Peer) {
        if (peer.iceRestartRecoverJob?.isActive == true) return
        peer.iceRestartRecoverJob = scope.launch {
            delay(ICE_RESTART_DEBOUNCE_MS + ICE_RESTART_WINDOW_MS * ICE_RESTART_MAX)
            val cur = peerOf(peerId)
            if (cur !== peer) return@launch
            val st = runCatching { peer.pc.iceConnectionState() }.getOrNull()
            if (st == PeerConnection.IceConnectionState.DISCONNECTED ||
                st == PeerConnection.IceConnectionState.FAILED
            ) removePeer(peerId)
            else peer.iceRestartRecoverJob = null
        }
    }

    private fun removePeer(peerId: String) {
        val peer = synchronized(peersLock) { peers.remove(peerId) }
        peer?.let {
            it.iceRestartDebounceJob?.cancel(); it.iceRestartDebounceJob = null
            it.iceRestartRecoverJob?.cancel(); it.iceRestartRecoverJob = null
            runCatching { it.pc.close(); it.pc.dispose() }
        }
        _remoteTracks.update { it - peerId }
        _state.update { it.copy(participants = peerIds()) }
        reapplyGroupCaps()   // A-3：人数减少 → 剩余 peer 按新人数重放码率/降档（撤销降档也靠它）
    }

    /** 建 offer(含弱网调优+A-2 H264 优先)并通过信令发给指定 peer；新成员加入和 ICE restart 重协商共用。 */
    private fun sendOffer(peerId: String, peer: Peer) {
        peer.pc.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                val tuned = SessionDescription(desc.type, tuneSdpForCall(desc.description))
                // 本地 offer 生效（进入 HAVE_LOCAL_OFFER）后再发：撞车判断/重连重发都以 signalingState 为准
                peer.pc.setLocalDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        socketManager.emitGroupCallOffer(_state.value.callId, peerId, tuned.description)
                    }
                }, tuned)
            }
        }, mediaConstraints())
    }

    // ── ICE restart 自愈(网络切换,mesh 每 peer 独立) ────────────────────
    // disconnected 3s 防抖 → restartIce() → 15s 恢复窗口 → 未恢复重试,最多 3 次 → removePeer。
    // 信令复用现有 group_call:offer/answer/ice;对端收到重协商 offer 走现有应答逻辑,后端零改动。
    // 只有 impolite 一方（userId 较小）发起，避免两端同时 restart 撞车。
    private fun tryPeerRestart(peerId: String) {
        val peer = peerOf(peerId) ?: return
        if (!isImpoliteTo(peerId)) return
        if (peer.iceRestartCount >= ICE_RESTART_MAX) { removePeer(peerId); return }
        peer.iceRestartCount++
        peer.pc.restartIce()
        sendOffer(peerId, peer)   // restartIce() 只打标记，必须实际重协商 offer 对方才会重新打通
        peer.iceRestartRecoverJob?.cancel()
        peer.iceRestartRecoverJob = scope.launch {
            delay(ICE_RESTART_WINDOW_MS)
            val cur = peerOf(peerId)
            val st = cur?.pc?.iceConnectionState()
            if (st == PeerConnection.IceConnectionState.DISCONNECTED ||
                st == PeerConnection.IceConnectionState.FAILED
            ) tryPeerRestart(peerId)
            else cur?.iceRestartRecoverJob = null
        }
    }

    private fun mediaConstraints() = MediaConstraints().apply {
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", if (_state.value.isVideo) "true" else "false"))
    }

    private fun cleanup() {
        callAttempt++
        participatingCallId = ""
        participatingResumeToken = null
        mutedForSystemCall = false
        audioRouter.release(audioListener)                 // 恢复 MODE_NORMAL/释放焦点与蓝牙
        localMediaReady = false
        if (foregroundStarted) {
            foregroundStarted = false
            CallForegroundService.stop(context)
        }
        val old = synchronized(peersLock) { peers.values.toList().also { peers.clear() } }
        old.forEach {
            it.iceRestartDebounceJob?.cancel(); it.iceRestartDebounceJob = null
            it.iceRestartRecoverJob?.cancel(); it.iceRestartRecoverJob = null
            runCatching { it.pc.close(); it.pc.dispose() }
        }
        _remoteTracks.value = emptyMap()
        runCatching { videoCapturer?.stopCapture() }
        runCatching { videoCapturer?.dispose() }; videoCapturer = null
        surfaceHelper?.dispose(); surfaceHelper = null
        localVideoTrack = null
        runCatching { videoSource?.dispose() }; videoSource = null
        runCatching { audioSource?.dispose() }; audioSource = null
        localAudioTrack = null
        _state.value = _state.value.copy(stage = GroupCallStage.ENDED, participants = emptyList())
    }

    private companion object {
        const val STREAM_ID = "g_stream"
        const val TAG = "GroupCallManager"
        // ICE restart 参数(与四端统一):防抖 3s / 恢复窗口 15s / 最大 3 次
        const val ICE_RESTART_DEBOUNCE_MS = 3000L
        const val ICE_RESTART_WINDOW_MS = 15000L
        const val ICE_RESTART_MAX = 3
    }
}
