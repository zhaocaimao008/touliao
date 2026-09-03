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
    var connectedAt: Date?            // 接通时刻，用于计算群通话时长(mm:ss)
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
        // ICE restart 自愈(网络切换):每 peer 独立计数与定时器,策略与 1:1 统一
        var iceRestartCount = 0
        var iceRestartDebounceTask: Task<Void, Never>?
        var iceRestartRecoverTask: Task<Void, Never>?
        init(pc: RTCPeerConnection, delegate: GCPeerDelegate) { self.pc = pc; self.delegate = delegate }

        func cancelIceRestart() {
            iceRestartDebounceTask?.cancel(); iceRestartDebounceTask = nil
            iceRestartRecoverTask?.cancel(); iceRestartRecoverTask = nil
            iceRestartCount = 0
        }
    }
    private var peers: [String: PeerEntry] = [:]

    private var iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
    private var cancellables = Set<AnyCancellable>()
    private let socket = SocketService.shared

    /// 建群通话/加入后的连接超时；始终停在 .connecting（服务端未回 started/peers）则自动结束。
    private var connectTimeoutTask: Task<Void, Never>?
    private let connectTimeoutSeconds: UInt64 = 45

    private override init() {
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
        super.init()
        observeSignaling()
    }

    // ICE restart 参数(与四端统一):防抖 3s / 恢复窗口 15s / 最大 3 次
    private let ICE_RESTART_DEBOUNCE_MS: UInt64 = 3_000_000_000
    private let ICE_RESTART_WINDOW_MS: UInt64 = 15_000_000_000
    private let ICE_RESTART_MAX = 3

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
                AVAudioSession.Category.playAndRecord,
                with: [.allowBluetooth]
            )
            try session.setMode(AVAudioSession.Mode.voiceChat)
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
        do { try session.setActive(false) } catch { print("[GroupCall] 会话停用失败: \(error.localizedDescription)") }
        session.unlockForConfiguration()
    }

    // MARK: - 连接超时
    /// 发起/加入群通话后启动 45s 超时；始终停在 .connecting 则自动结束（服务端无响应/无人接）。
    private func startConnectTimeout() {
        cancelConnectTimeout()
        connectTimeoutTask = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: self.connectTimeoutSeconds * 1_000_000_000)
            guard !Task.isCancelled else { return }
            if self.state.stage == .connecting { self.hangup() }
        }
    }

    private func cancelConnectTimeout() {
        connectTimeoutTask?.cancel()
        connectTimeoutTask = nil
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
        startConnectTimeout()                   // 连接超时自动结束
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
        startConnectTimeout()                   // 连接超时自动结束
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
            self.cancelConnectTimeout()         // 服务端已确认，撤销连接超时
            if self.state.connectedAt == nil { self.state.connectedAt = Date() }
            self.state.stage = .connected; self.state.callId = callId
        }.store(in: &cancellables)

        socket.gcPeers.receive(on: DispatchQueue.main).sink { [weak self] (callId, _, peers) in
            guard let self else { return }
            if !self.state.callId.isEmpty && callId != self.state.callId { return }
            self.cancelConnectTimeout()         // 服务端已确认，撤销连接超时
            if self.state.connectedAt == nil { self.state.connectedAt = Date() }
            self.state.stage = .connected; self.state.callId = callId
            peers.forEach { _ = self.peerFor($0) }   // answerer：预建 PC 等 offer
            self.state.participants = Array(self.peers.keys)
        }.store(in: &cancellables)

        socket.gcPeerJoined.receive(on: DispatchQueue.main).sink { [weak self] (callId, userId) in
            guard let self, callId == self.state.callId, let entry = self.peerFor(userId) else { return }
            self.state.participants = Array(self.peers.keys)
            entry.pc.offer(for: self.mediaConstraints()) { [weak self] desc, err in
                guard let self, let desc, err == nil else { return }
                let tuned = RTCSessionDescription(type: desc.type, sdp: tuneSdpForWeakNetwork(desc.sdp))
                entry.pc.setLocalDescription(tuned) { _ in }
                self.socket.emitGroupCallOffer(callId: self.state.callId, to: userId, sdp: tuned.sdp)
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
                    let tuned = RTCSessionDescription(type: desc.type, sdp: tuneSdpForWeakNetwork(desc.sdp))
                    entry.pc.setLocalDescription(tuned) { _ in }
                    self.socket.emitGroupCallAnswer(callId: self.state.callId, to: from, sdp: tuned.sdp)
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

        // 服务端强制结束（如超过时长上限）：无条件结束本地通话并回收资源
        socket.gcEnded.receive(on: DispatchQueue.main).sink { [weak self] (callId, _) in
            guard let self else { return }
            guard self.state.stage != .idle, callId.isEmpty || callId == self.state.callId else { return }
            self.cleanup()
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
        // WebRTC 回调线程 → 统一切主线程访问 peers(与 1:1 CallManager 一致)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            switch newState {
            case .connected, .completed:
                // restart 后恢复:清定时器 + 计数清零(可反复自愈)
                self.peers[peerId]?.cancelIceRestart()
            case .disconnected:
                // 短时探测间隙:3s 防抖后再重启,避免无谓重协商
                guard let entry = self.peers[peerId] else { return }
                entry.iceRestartDebounceTask?.cancel(); entry.iceRestartDebounceTask = nil
                entry.iceRestartRecoverTask?.cancel(); entry.iceRestartRecoverTask = nil
                entry.iceRestartDebounceTask = Task { @MainActor [weak self, weak entry] in
                    try? await Task.sleep(nanoseconds: self?.ICE_RESTART_DEBOUNCE_MS ?? 3_000_000_000)
                    guard let self, let entry, !Task.isCancelled else { return }
                    self.tryPeerRestart(peerId, entry: entry)
                }
            case .failed:
                // 首次 failed:给一次 restart 机会;已重启过且非窗口期 → 移除
                guard let entry = self.peers[peerId] else { return }
                if entry.iceRestartCount == 0 && entry.iceRestartRecoverTask == nil {
                    self.tryPeerRestart(peerId, entry: entry)
                } else if entry.iceRestartRecoverTask == nil {
                    self.removePeer(peerId)
                }
            case .closed:
                self.removePeer(peerId)
            default: break
            }
        }
    }

    // MARK: - ICE restart 自愈(网络切换,mesh 每 peer 独立)
    /// disconnected 3s 防抖后重启该 peer 的 ICE;15s 恢复窗口内未恢复则重试(最多 3 次)→ 移除。
    /// 信令复用现有 group_call:offer/answer/ice,对端收到重协商 offer 走现有应答逻辑,后端零改动。
    private func tryPeerRestart(_ peerId: String, entry: PeerEntry) {
        if entry.iceRestartCount >= ICE_RESTART_MAX {
            removePeer(peerId)
            return
        }
        entry.iceRestartCount += 1
        entry.pc.restartIce()
        entry.iceRestartRecoverTask?.cancel()
        entry.iceRestartRecoverTask = Task { @MainActor [weak self, weak entry] in
            try? await Task.sleep(nanoseconds: self?.ICE_RESTART_WINDOW_MS ?? 15_000_000_000)
            guard let self, let entry, !Task.isCancelled else { return }
            // entry.pc 非可选,iceConnectionState 非 Optional,直接比较
            let st = entry.pc.iceConnectionState
            if st == .disconnected || st == .failed {
                self.tryPeerRestart(peerId, entry: entry)
            } else {
                entry.iceRestartRecoverTask = nil
            }
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
        peers[peerId]?.cancelIceRestart()
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

    /// 弱网调优（2026-09-02）：Opus inband FEC + 码率上限 64kbps + 单声道（与 CallManager 一致）。
    private func cleanup() {
        cancelConnectTimeout()              // 取消连接超时，避免泄漏
        peers.values.forEach { $0.cancelIceRestart() }
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
