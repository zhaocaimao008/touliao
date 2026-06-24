package com.vxin.app.core.call

import android.content.Context
import android.util.Log
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.di.AppScope
import com.vxin.app.core.realtime.SocketManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
)

/**
 * 群音视频通话（mesh）。信令协议见 backend-v2/docs/GROUP_CALL.md。
 * 与 [CallManager] 各自独立；本地音视频轨只建一份，加入到每条 PeerConnection。
 * 防 glare：新加入者只 answer；既有成员收到 peer_joined 才向其 createOffer。
 */
@Singleton
class GroupCallManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val socketManager: SocketManager,
    private val sessionManager: SessionManager,
    private val turnApi: com.vxin.app.data.api.TurnApi,
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

    private data class Peer(
        val pc: PeerConnection,
        var remoteDescSet: Boolean = false,
        val pendingIce: MutableList<IceCandidate> = mutableListOf(),
    )
    private val peers = LinkedHashMap<String, Peer>()

    private val _state = MutableStateFlow(GroupCallState())
    val state: StateFlow<GroupCallState> = _state.asStateFlow()

    // 远端视频轨：peerId -> VideoTrack，供 UI 宫格渲染
    private val _remoteTracks = MutableStateFlow<Map<String, VideoTrack>>(emptyMap())
    val remoteTracks: StateFlow<Map<String, VideoTrack>> = _remoteTracks.asStateFlow()

    private val fallbackIceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
    )
    @Volatile private var iceServers: List<PeerConnection.IceServer> = fallbackIceServers

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
        if (_state.value.stage != GroupCallStage.IDLE && _state.value.stage != GroupCallStage.ENDED) return
        _state.value = GroupCallState(GroupCallStage.CONNECTING, conversationId = conversationId, isVideo = video)
        scope.launch {
            refreshIceServers()
            if (_state.value.stage == GroupCallStage.ENDED) return@launch
            createLocalMedia(video)
            socketManager.emitGroupCallStart(conversationId, if (video) "video" else "audio")
        }
    }

    /** 加入已有群通话 */
    fun join(callId: String, conversationId: String, video: Boolean) {
        if (_state.value.stage != GroupCallStage.IDLE && _state.value.stage != GroupCallStage.ENDED) return
        _state.value = GroupCallState(GroupCallStage.CONNECTING, callId, conversationId, isVideo = video)
        scope.launch {
            refreshIceServers()
            if (_state.value.stage == GroupCallStage.ENDED) return@launch
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

    fun consumeEnded() {
        if (_state.value.stage == GroupCallStage.ENDED) _state.value = GroupCallState()
    }

    // ── 信令处理 ───────────────────────────────────────────
    private fun observeSignaling() {
        scope.launch {
            socketManager.groupCallStartedEvents.collect { e ->
                if (_state.value.stage == GroupCallStage.ENDED) return@collect
                _state.update { it.copy(stage = GroupCallStage.CONNECTED, callId = e.callId) }
            }
        }
        scope.launch {
            socketManager.groupCallPeersEvents.collect { e ->
                if (_state.value.callId.isNotEmpty() && e.callId != _state.value.callId) return@collect
                _state.update { it.copy(stage = GroupCallStage.CONNECTED, callId = e.callId) }
                // 作为 answerer：为既有成员预建 PC，等其 offer
                e.peers.forEach { pid -> peerFor(pid) }
                _state.update { it.copy(participants = peers.keys.toList()) }
            }
        }
        scope.launch {
            socketManager.groupCallPeerJoinedEvents.collect { e ->
                if (e.callId != _state.value.callId) return@collect
                val peer = peerFor(e.userId)
                _state.update { it.copy(participants = peers.keys.toList()) }
                // 既有成员向新 peer 发 offer
                peer.pc.createOffer(object : SimpleSdpObserver() {
                    override fun onCreateSuccess(desc: SessionDescription) {
                        peer.pc.setLocalDescription(SimpleSdpObserver(), desc)
                        socketManager.emitGroupCallOffer(_state.value.callId, e.userId, desc.description)
                    }
                }, mediaConstraints())
            }
        }
        scope.launch {
            socketManager.groupCallOfferEvents.collect { e ->
                if (e.callId != _state.value.callId) return@collect
                val peer = peerFor(e.from)
                _state.update { it.copy(participants = peers.keys.toList()) }
                peer.pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        peer.remoteDescSet = true; drainIce(e.from)
                        peer.pc.createAnswer(object : SimpleSdpObserver() {
                            override fun onCreateSuccess(desc: SessionDescription) {
                                peer.pc.setLocalDescription(SimpleSdpObserver(), desc)
                                socketManager.emitGroupCallAnswer(_state.value.callId, e.from, desc.description)
                            }
                        }, mediaConstraints())
                    }
                }, SessionDescription(SessionDescription.Type.OFFER, e.sdp))
            }
        }
        scope.launch {
            socketManager.groupCallAnswerEvents.collect { e ->
                val peer = peers[e.from] ?: return@collect
                peer.pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() { peer.remoteDescSet = true; drainIce(e.from) }
                }, SessionDescription(SessionDescription.Type.ANSWER, e.sdp))
            }
        }
        scope.launch {
            socketManager.groupCallIceEvents.collect { e ->
                val peer = peers[e.from] ?: return@collect
                val cand = IceCandidate(e.sdpMid, e.sdpMLineIndex, e.candidate)
                if (peer.remoteDescSet) peer.pc.addIceCandidate(cand) else peer.pendingIce.add(cand)
            }
        }
        scope.launch {
            socketManager.groupCallPeerLeftEvents.collect { e -> removePeer(e.userId) }
        }
        scope.launch {
            socketManager.groupCallErrorEvents.collect { e ->
                Log.w(TAG, "group call error: ${e.reason}")
                if (_state.value.stage != GroupCallStage.CONNECTED) cleanup()
            }
        }
    }

    private fun drainIce(peerId: String) {
        val peer = peers[peerId] ?: return
        peer.pendingIce.forEach { peer.pc.addIceCandidate(it) }
        peer.pendingIce.clear()
    }

    // ── WebRTC ───────────────────────────────────────────
    private fun createLocalMedia(video: Boolean) {
        val f = factory ?: return
        audioSource = f.createAudioSource(MediaConstraints())
        localAudioTrack = f.createAudioTrack("g_audio", audioSource).apply { setEnabled(true) }
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

    // 为某 peer 建立 PeerConnection（含本地轨）。幂等。
    private fun peerFor(peerId: String): Peer {
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
                if (state == PeerConnection.IceConnectionState.FAILED ||
                    state == PeerConnection.IceConnectionState.CLOSED) removePeer(peerId)
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
        return peer
    }

    private fun removePeer(peerId: String) {
        peers.remove(peerId)?.let { runCatching { it.pc.close(); it.pc.dispose() } }
        _remoteTracks.update { it - peerId }
        _state.update { it.copy(participants = peers.keys.toList()) }
    }

    private fun mediaConstraints() = MediaConstraints().apply {
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", if (_state.value.isVideo) "true" else "false"))
    }

    private fun cleanup() {
        peers.values.forEach { runCatching { it.pc.close(); it.pc.dispose() } }
        peers.clear()
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
    }
}
