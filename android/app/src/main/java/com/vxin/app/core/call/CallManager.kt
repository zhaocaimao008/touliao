package com.vxin.app.core.call

import android.content.Context
import android.util.Log
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.di.AppScope
import com.vxin.app.core.realtime.SocketManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    val micEnabled: Boolean = true,
    val cameraEnabled: Boolean = true,
    val remoteVideoActive: Boolean = false,
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
    private val turnApi: com.vxin.app.data.api.TurnApi,
    @AppScope private val scope: CoroutineScope,
) {
    val eglBase: EglBase = EglBase.create()

    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var callTimeoutJob: Job? = null   // 主叫呼出超时:对方无应答/断线时自动收尾,防卡死"呼叫中"
    private var audioSource: org.webrtc.AudioSource? = null
    private var videoSource: VideoSource? = null
    private var localAudioTrack: AudioTrack? = null
    private var videoCapturer: VideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null

    var localVideoTrack: VideoTrack? = null
        private set
    var remoteVideoTrack: VideoTrack? = null
        private set

    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteDescSet = false

    private val _state = MutableStateFlow(CallState())
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
        _state.value = CallState(CallStage.OUTGOING, peerId, peerName, isVideo = video, isCaller = true)
        // 本地呼出超时:60s 内未接通(对方不接/断线,后端 timeout 不向主叫发事件)则自动挂断收尾,
        // 防止界面永远卡在"呼叫中"。接通(CONNECTED)或挂断时取消(见 cleanup / IceConnectionState)。
        callTimeoutJob?.cancel()
        callTimeoutJob = scope.launch {
            delay(60_000)
            val st = _state.value.stage
            if (st == CallStage.OUTGOING || st == CallStage.CONNECTING) {
                if (_state.value.peerId.isNotEmpty()) socketManager.emitCallEnd(_state.value.peerId)
                cleanup(CallStage.ENDED)
            }
        }
        scope.launch {
            refreshIceServers()                 // 先拿到含 TURN 的 ICE，再建连接
            if (_state.value.stage == CallStage.ENDED) return@launch  // 期间被取消
            createPeerConnection()
            createLocalTracks(video)
            val name = sessionManager.currentUser?.username.orEmpty()
            socketManager.emitCallRequest(peerId, if (video) "video" else "audio", name)
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
            socketManager.emitCallResponse(s.peerId, true)
            // 等待主叫的 call:offer
        }
    }

    /** 被叫拒接 */
    fun reject() {
        val s = _state.value
        if (s.peerId.isNotEmpty()) socketManager.emitCallResponse(s.peerId, false)
        cleanup(CallStage.ENDED)
    }

    /** 挂断（任一方） */
    fun hangup() {
        val s = _state.value
        if (s.peerId.isNotEmpty()) socketManager.emitCallEnd(s.peerId)
        cleanup(CallStage.ENDED)
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

    // ── 信令处理 ───────────────────────────────────────────
    private fun observeSignaling() {
        scope.launch {
            socketManager.callIncomingEvents.collect { e ->
                if (_state.value.stage != CallStage.IDLE && _state.value.stage != CallStage.ENDED) {
                    // 忙线：直接拒接
                    socketManager.emitCallResponse(e.from, false)
                    return@collect
                }
                _state.value = CallState(
                    CallStage.INCOMING, e.from, e.callerName, isVideo = e.type == "video", isCaller = false,
                )
            }
        }
        scope.launch {
            socketManager.callResponseEvents.collect { e ->
                val s = _state.value
                if (!s.isCaller || e.from != s.peerId) return@collect
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
                if (e.from != _state.value.peerId) return@collect
                val pc = peerConnection ?: return@collect
                pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        remoteDescSet = true
                        drainIce()
                        createAnswerAndSend()
                    }
                }, SessionDescription(SessionDescription.Type.OFFER, e.sdp))
            }
        }
        scope.launch {
            socketManager.callAnswerEvents.collect { e ->
                if (e.from != _state.value.peerId) return@collect
                val pc = peerConnection ?: return@collect
                pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() { remoteDescSet = true; drainIce() }
                }, SessionDescription(SessionDescription.Type.ANSWER, e.sdp))
            }
        }
        scope.launch {
            socketManager.callIceEvents.collect { e ->
                if (e.from != _state.value.peerId) return@collect
                val cand = IceCandidate(e.sdpMid, e.sdpMLineIndex, e.candidate)
                if (remoteDescSet) peerConnection?.addIceCandidate(cand) else pendingIce.add(cand)
            }
        }
        scope.launch {
            socketManager.callEndEvents.collect { e ->
                if (e.from == _state.value.peerId) cleanup(CallStage.ENDED)
            }
        }
    }

    private fun drainIce() {
        pendingIce.forEach { peerConnection?.addIceCandidate(it) }
        pendingIce.clear()
    }

    private fun createOfferAndSend() {
        val pc = peerConnection ?: return
        pc.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(SimpleSdpObserver(), desc)
                socketManager.emitCallOffer(_state.value.peerId, desc.description)
            }
        }, mediaConstraints())
    }

    private fun createAnswerAndSend() {
        val pc = peerConnection ?: return
        pc.createAnswer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(SimpleSdpObserver(), desc)
                socketManager.emitCallAnswer(_state.value.peerId, desc.description)
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
        remoteDescSet = false
        pendingIce.clear()
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        peerConnection = f.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                socketManager.emitCallIce(_state.value.peerId, candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)
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
                    PeerConnection.IceConnectionState.COMPLETED ->
                        _state.update { if (it.stage != CallStage.ENDED) it.copy(stage = CallStage.CONNECTED) else it }
                    PeerConnection.IceConnectionState.DISCONNECTED,
                    PeerConnection.IceConnectionState.FAILED,
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
        callTimeoutJob?.cancel(); callTimeoutJob = null   // 接通/挂断/被拒 → 取消呼出超时
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
        remoteDescSet = false
        pendingIce.clear()
        _state.value = _state.value.copy(stage = finalStage)
    }

    private companion object {
        const val STREAM_ID = "stream0"
        const val TAG = "CallManager"
    }
}

/** SdpObserver 默认空实现，按需重写 */
open class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) { Log.w("CallManager", "sdp create fail: $error") }
    override fun onSetFailure(error: String?) { Log.w("CallManager", "sdp set fail: $error") }
}
