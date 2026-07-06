import Foundation
import Combine
import AVFoundation
import WebRTC

enum GroupCallStage { case idle, connecting, connected, ended }

struct GroupCallInvite: Identifiable {
    let callId: String
    let conversationId: String
    let type: String
    let from: String
    let fromName: String
    var id: String { callId }
}

struct GroupCallState {
    var stage: GroupCallStage = .idle
    var callId: String = ""
    var conversationId: String = ""
    var isVideo: Bool = false
    var participants: [String] = []   // 远端成员 id（不含自己）
    var micEnabled: Bool = true
    var cameraEnabled: Bool = true
}

/// 群音视频通话（mesh）。信令协议见 backend-v2/docs/GROUP_CALL.md。
/// 与 [CallManager] 各自独立；本地音视频轨只建一份，加入到每条 PeerConnection。
/// 防 glare：新加入者只 answer；既有成员收到 peer_joined 才向其 createOffer。
final class GroupCallManager: NSObject, ObservableObject {
    static let shared = GroupCallManager()

    @Published private(set) var state = GroupCallState()
    @Published private(set) var remoteTracks: [String: RTCVideoTrack] = [:]
    @Published var pendingInvite: GroupCallInvite?

    private let factory: RTCPeerConnectionFactory
    private var localAudioTrack: RTCAudioTrack?
    private(set) var localVideoTrack: RTCVideoTrack?
    private var videoCapturer: RTCCameraVideoCapturer?

    final class PeerEntry {
        let pc: RTCPeerConnection
        let delegate: GCPeerDelegate
        var remoteDescSet = false
        var pendingIce: [RTCIceCandidate] = []
        init(pc: RTCPeerConnection, delegate: GCPeerDelegate) { self.pc = pc; self.delegate = delegate }
    }
    private var peers: [String: PeerEntry] = [:]

    private var iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
    private var cancellables = Set<AnyCancellable>()
    private let socket = SocketService.shared

    private override init() {
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
        super.init()
        observeSignaling()
    }

    func activate() {}

    // MARK: - 音频会话（WebRTC）
    /// 建流前配置 RTCAudioSession 为通话模式(.playAndRecord/.voiceChat)。
    /// 走 RTCAudioSession 而非裸 AVAudioSession：WebRTC 内部持有会话，只有经其配置才与音频单元协调。
    /// 通话期间语音消息播放(AudioPlayerService)不应抢占本会话。
    private func configureAudioSession() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do {
            try session.setCategory(
                AVAudioSession.Category.playAndRecord.rawValue,
                with: [.allowBluetooth]
            )
            try session.setMode(AVAudioSession.Mode.voiceChat.rawValue)
            try session.setActive(true)
        } catch {
            // 配置失败不阻断通话；WebRTC 兜底默认会话
        }
        session.unlockForConfiguration()
    }

    /// 通话结束释放音频会话，交还系统。
    private func deactivateAudioSession() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        try? session.setActive(false)
        session.unlockForConfiguration()
    }

    private func refreshIceServers() async {
        do {
            let creds: TurnCredentials = try await APIClient.shared.send("api/turn/credentials")
            let servers = creds.iceServers.compactMap { dto -> RTCIceServer? in
                guard !dto.urls.isEmpty else { return nil }
                if let u = dto.username, let c = dto.credential {
                    return RTCIceServer(urlStrings: dto.urls, username: u, credential: c)
                }
                return RTCIceServer(urlStrings: dto.urls)
            }
            if !servers.isEmpty { iceServers = servers }
        } catch { /* 兜底 STUN */ }
    }

    // MARK: - 对外动作
    func start(conversationId: String, video: Bool) {
        guard state.stage == .idle || state.stage == .ended else { return }
        pendingInvite = nil
        state = GroupCallState(stage: .connecting, conversationId: conversationId, isVideo: video)
        Task { @MainActor in
            await refreshIceServers()
            guard state.stage != .ended else { return }
            configureAudioSession()             // 建流前配好通话音频会话
            createLocalMedia(video: video)
            socket.emitGroupCallStart(conversationId: conversationId, type: video ? "video" : "audio")
        }
    }

    func join(callId: String, conversationId: String, video: Bool) {
        guard state.stage == .idle || state.stage == .ended else { return }
        pendingInvite = nil
        state = GroupCallState(stage: .connecting, callId: callId, conversationId: conversationId, isVideo: video)
        Task { @MainActor in
            await refreshIceServers()
            guard state.stage != .ended else { return }
            configureAudioSession()             // 建流前配好通话音频会话
            createLocalMedia(video: video)
            socket.emitGroupCallJoin(callId: callId)
        }
    }

    func hangup() {
        if !state.callId.isEmpty { socket.emitGroupCallLeave(callId: state.callId) }
        cleanup()
    }

    func toggleMic() {
        let on = !state.micEnabled
        localAudioTrack?.isEnabled = on
        state.micEnabled = on
    }
    func toggleCamera() {
        let on = !state.cameraEnabled
        localVideoTrack?.isEnabled = on
        state.cameraEnabled = on
    }
    func switchCamera() {
        guard let capturer = videoCapturer else { return }
        let current = capturer.captureSession.inputs.compactMap { ($0 as? AVCaptureDeviceInput)?.device.position }.first ?? .front
        startCapture(position: current == .front ? .back : .front)
    }
    func consumeEnded() { if state.stage == .ended { state = GroupCallState() } }

    // MARK: - 信令
    private func observeSignaling() {
        socket.gcInvite.receive(on: DispatchQueue.main).sink { [weak self] inv in
            guard let self else { return }
            if self.state.stage == .connecting || self.state.stage == .connected { return }
            self.pendingInvite = GroupCallInvite(callId: inv.callId, conversationId: inv.conversationId, type: inv.type, from: inv.from, fromName: inv.fromName)
        }.store(in: &cancellables)

        socket.gcStarted.receive(on: DispatchQueue.main).sink { [weak self] (callId, _) in
            guard let self, self.state.stage != .ended else { return }
            self.state.stage = .connected; self.state.callId = callId
        }.store(in: &cancellables)

        socket.gcPeers.receive(on: DispatchQueue.main).sink { [weak self] (callId, _, peers) in
            guard let self else { return }
            if !self.state.callId.isEmpty && callId != self.state.callId { return }
            self.state.stage = .connected; self.state.callId = callId
            peers.forEach { _ = self.peerFor($0) }   // answerer：预建 PC 等 offer
            self.state.participants = Array(self.peers.keys)
        }.store(in: &cancellables)

        socket.gcPeerJoined.receive(on: DispatchQueue.main).sink { [weak self] (callId, userId) in
            guard let self, callId == self.state.callId, let entry = self.peerFor(userId) else { return }
            self.state.participants = Array(self.peers.keys)
            entry.pc.offer(for: self.mediaConstraints()) { [weak self] desc, err in
                guard let self, let desc, err == nil else { return }
                entry.pc.setLocalDescription(desc) { _ in }
                self.socket.emitGroupCallOffer(callId: self.state.callId, to: userId, sdp: desc.sdp)
            }
        }.store(in: &cancellables)

        socket.gcOffer.receive(on: DispatchQueue.main).sink { [weak self] (callId, from, sdp) in
            guard let self, callId == self.state.callId, let entry = self.peerFor(from) else { return }
            self.state.participants = Array(self.peers.keys)
            entry.pc.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp)) { [weak self] err in
                guard let self, err == nil else { return }
                entry.remoteDescSet = true; self.drainIce(from)
                entry.pc.answer(for: self.mediaConstraints()) { [weak self] desc, err in
                    guard let self, let desc, err == nil else { return }
                    entry.pc.setLocalDescription(desc) { _ in }
                    self.socket.emitGroupCallAnswer(callId: self.state.callId, to: from, sdp: desc.sdp)
                }
            }
        }.store(in: &cancellables)

        socket.gcAnswer.receive(on: DispatchQueue.main).sink { [weak self] (_, from, sdp) in
            guard let self, let entry = self.peers[from] else { return }
            entry.pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [weak self] err in
                guard let self, err == nil else { return }
                entry.remoteDescSet = true; self.drainIce(from)
            }
        }.store(in: &cancellables)

        socket.gcIce.receive(on: DispatchQueue.main).sink { [weak self] (_, from, candidate, sdpMid, idx) in
            guard let self, let entry = self.peers[from] else { return }
            let cand = RTCIceCandidate(sdp: candidate, sdpMLineIndex: idx, sdpMid: sdpMid)
            if entry.remoteDescSet { entry.pc.add(cand) } else { entry.pendingIce.append(cand) }
        }.store(in: &cancellables)

        socket.gcPeerLeft.receive(on: DispatchQueue.main).sink { [weak self] (_, userId) in
            self?.removePeer(userId)
        }.store(in: &cancellables)

        socket.gcError.receive(on: DispatchQueue.main).sink { [weak self] _ in
            guard let self else { return }
            if self.state.stage != .connected { self.cleanup() }
        }.store(in: &cancellables)
    }

    private func drainIce(_ peerId: String) {
        guard let entry = peers[peerId] else { return }
        entry.pendingIce.forEach { entry.pc.add($0) }
        entry.pendingIce.removeAll()
    }

    // MARK: - per-peer 回调（由 GCPeerDelegate 转发）
    func onIce(_ peerId: String, _ candidate: RTCIceCandidate) {
        socket.emitGroupCallIce(callId: state.callId, to: peerId, candidate: candidate.sdp, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex)
    }
    func onRemoteVideo(_ peerId: String, _ track: RTCVideoTrack) {
        DispatchQueue.main.async { self.remoteTracks[peerId] = track }
    }
    func onIceState(_ peerId: String, _ newState: RTCIceConnectionState) {
        if newState == .failed || newState == .closed {
            DispatchQueue.main.async { self.removePeer(peerId) }
        }
    }

    // MARK: - WebRTC
    private func createLocalMedia(video: Bool) {
        let audioSource = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        localAudioTrack = factory.audioTrack(with: audioSource, trackId: "g_audio")
        if video {
            let videoSource = factory.videoSource()
            videoCapturer = RTCCameraVideoCapturer(delegate: videoSource)
            localVideoTrack = factory.videoTrack(with: videoSource, trackId: "g_video")
            startCapture(position: .front)
        }
    }

    private func startCapture(position: AVCaptureDevice.Position) {
        guard let capturer = videoCapturer else { return }
        let devices = RTCCameraVideoCapturer.captureDevices()
        guard let device = devices.first(where: { $0.position == position }) ?? devices.first else { return }
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        let format = formats.sorted {
            let d1 = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            let d2 = CMVideoFormatDescriptionGetDimensions($1.formatDescription)
            return d1.width * d1.height < d2.width * d2.height
        }.first(where: { CMVideoFormatDescriptionGetDimensions($0.formatDescription).width >= 640 }) ?? formats.last
        guard let format else { return }
        let fps = format.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 30
        capturer.startCapture(with: device, format: format, fps: Int(min(fps, 30)))
    }

    private func peerFor(_ peerId: String) -> PeerEntry? {
        if let e = peers[peerId] { return e }
        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        let delegate = GCPeerDelegate(peerId: peerId, manager: self)
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let pc = factory.peerConnection(with: config, constraints: constraints, delegate: delegate) else { return nil }
        if let a = localAudioTrack { pc.add(a, streamIds: ["g_stream"]) }
        if let v = localVideoTrack { pc.add(v, streamIds: ["g_stream"]) }
        let entry = PeerEntry(pc: pc, delegate: delegate)
        peers[peerId] = entry
        return entry
    }

    private func removePeer(_ peerId: String) {
        peers[peerId]?.pc.close()
        peers[peerId] = nil
        remoteTracks[peerId] = nil
        state.participants = Array(peers.keys)
    }

    private func mediaConstraints() -> RTCMediaConstraints {
        RTCMediaConstraints(
            mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": state.isVideo ? "true" : "false"],
            optionalConstraints: nil
        )
    }

    private func cleanup() {
        peers.values.forEach { $0.pc.close() }
        peers.removeAll()
        remoteTracks.removeAll()
        videoCapturer?.stopCapture()
        videoCapturer = nil
        localVideoTrack = nil
        localAudioTrack = nil
        deactivateAudioSession()            // 释放通话音频会话
        state.stage = .ended
        state.participants = []
    }
}

/// 每条 PeerConnection 一个委托，把回调连同 peerId 转回 manager。
final class GCPeerDelegate: NSObject, RTCPeerConnectionDelegate {
    let peerId: String
    weak var manager: GroupCallManager?
    init(peerId: String, manager: GroupCallManager) { self.peerId = peerId; self.manager = manager }

    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        manager?.onIce(peerId, candidate)
    }
    func peerConnection(_ pc: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams mediaStreams: [RTCMediaStream]) {
        if let track = rtpReceiver.track as? RTCVideoTrack { manager?.onRemoteVideo(peerId, track) }
    }
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        manager?.onIceState(peerId, newState)
    }
    func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
