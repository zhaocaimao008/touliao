import Foundation
import Combine
import AVFoundation
import WebRTC

enum CallStage { case idle, outgoing, incoming, connecting, connected, ended }

struct CallState {
    var stage: CallStage = .idle
    var peerId: String = ""
    var peerName: String = ""
    var isVideo: Bool = false
    var isCaller: Bool = false
    var micEnabled: Bool = true
    var cameraEnabled: Bool = true
    var remoteVideoActive: Bool = false
    var timedOut: Bool = false          // 主叫未接听超时 → 结束页提示"对方未接听"
}

/// GET /api/turn/credentials 响应。
struct TurnCredentials: Decodable {
    struct IceServerDTO: Decodable {
        let urls: [String]
        let username: String?
        let credential: String?
    }
    let iceServers: [IceServerDTO]
    let ttl: Int?
}

/// WebRTC 1对1 音视频通话。信令走 SocketService（call:* 事件）。与 Android CallManager 等价。
final class CallManager: NSObject, ObservableObject {
    static let shared = CallManager()

    @Published private(set) var state = CallState()

    private let factory: RTCPeerConnectionFactory
    private var pc: RTCPeerConnection?
    private var localAudioTrack: RTCAudioTrack?
    private(set) var localVideoTrack: RTCVideoTrack?
    private(set) var remoteVideoTrack: RTCVideoTrack?
    private var videoCapturer: RTCCameraVideoCapturer?

    private var pendingIce: [RTCIceCandidate] = []
    private var remoteDescSet = false
    private var cancellables = Set<AnyCancellable>()
    private let socket = SocketService.shared

    /// 主叫呼叫超时任务（未接听自动挂断）；接通/挂断时取消，避免泄漏。
    private var callTimeoutTask: Task<Void, Never>?
    private let callTimeoutSeconds: UInt64 = 45

    // STUN-only 兜底；通话前 refreshIceServers() 会向后端拉取含 TURN 的完整列表
    private let fallbackIceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
    private var iceServers: [RTCIceServer]

    /// 通话建立前刷新 ICE（含时效 TURN 凭证）。失败保留兜底，不阻断通话。
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
        } catch {
            // 离线/未配 TURN：保留兜底 STUN
        }
    }

    private override init() {
        iceServers = fallbackIceServers
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
        super.init()
        observeSignaling()
    }

    /// 应用启动后调用一次，确保单例创建并开始监听来电
    func activate() {}

    // MARK: - 音频会话（WebRTC）
    /// 建流前配置 RTCAudioSession 为通话模式(.playAndRecord/.voiceChat)。
    /// 必须走 RTCAudioSession 而非裸 AVAudioSession：WebRTC 内部持有并会覆盖 AVAudioSession，
    /// 只有经 RTCAudioSession.lockForConfiguration 修改才与其音频单元协调，否则通话无声/路由错乱。
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

    /// 通话结束释放音频会话，交还系统（便于语音消息/系统音恢复常规路由）。
    private func deactivateAudioSession() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        try? session.setActive(false)
        session.unlockForConfiguration()
    }

    // MARK: - 呼叫超时
    /// 主叫发起后启动 45s 超时；期间未接通则自动挂断并提示"对方未接听"。
    private func startCallTimeout() {
        cancelCallTimeout()
        callTimeoutTask = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: self.callTimeoutSeconds * 1_000_000_000)
            guard !Task.isCancelled else { return }
            // 仍在呼叫/连接中（未接通、未挂断）才判定为未接听
            guard self.state.stage == .outgoing || self.state.stage == .connecting else { return }
            if !self.state.peerId.isEmpty { self.socket.emitCallEnd(to: self.state.peerId) }
            self.cleanup(.ended)
            self.state.timedOut = true
        }
    }

    private func cancelCallTimeout() {
        callTimeoutTask?.cancel()
        callTimeoutTask = nil
    }

    // MARK: - 对外动作
    func startCall(peerId: String, peerName: String, video: Bool, callerName: String) {
        guard state.stage == .idle || state.stage == .ended else { return }
        state = CallState(stage: .outgoing, peerId: peerId, peerName: peerName, isVideo: video, isCaller: true)
        startCallTimeout()                      // 未接听 45s 自动挂断
        Task { @MainActor in
            await refreshIceServers()           // 先拿到含 TURN 的 ICE，再建连接
            guard state.stage != .ended else { return }   // 期间被取消
            configureAudioSession()             // 建流前配好通话音频会话
            createPeerConnection()
            createLocalTracks(video: video)
            socket.emitCallRequest(to: peerId, type: video ? "video" : "audio", callerName: callerName)
        }
    }

    func accept() {
        guard state.stage == .incoming else { return }
        state.stage = .connecting
        Task { @MainActor in
            await refreshIceServers()
            guard state.stage != .ended else { return }
            configureAudioSession()             // 建流前配好通话音频会话
            createPeerConnection()
            createLocalTracks(video: state.isVideo)
            socket.emitCallResponse(to: state.peerId, accepted: true)
        }
    }

    func reject() {
        if !state.peerId.isEmpty { socket.emitCallResponse(to: state.peerId, accepted: false) }
        cleanup(.ended)
    }

    func hangup() {
        if !state.peerId.isEmpty { socket.emitCallEnd(to: state.peerId) }
        cleanup(.ended)
    }

    func toggleMic() {
        let enabled = !state.micEnabled
        localAudioTrack?.isEnabled = enabled
        state.micEnabled = enabled
    }

    func toggleCamera() {
        let enabled = !state.cameraEnabled
        localVideoTrack?.isEnabled = enabled
        state.cameraEnabled = enabled
    }

    func switchCamera() {
        guard let capturer = videoCapturer else { return }
        let current = capturer.captureSession.inputs
            .compactMap { ($0 as? AVCaptureDeviceInput)?.device.position }.first ?? .front
        let target: AVCaptureDevice.Position = current == .front ? .back : .front
        startCapture(position: target)
    }

    func consumeEnded() {
        if state.stage == .ended { state = CallState() }
    }

    // MARK: - 信令
    private func observeSignaling() {
        socket.callIncoming.receive(on: DispatchQueue.main).sink { [weak self] (from, type, name) in
            guard let self else { return }
            if self.state.stage != .idle && self.state.stage != .ended {
                self.socket.emitCallResponse(to: from, accepted: false); return
            }
            self.state = CallState(stage: .incoming, peerId: from, peerName: name, isVideo: type == "video", isCaller: false)
        }.store(in: &cancellables)

        socket.callResponse.receive(on: DispatchQueue.main).sink { [weak self] (from, accepted) in
            guard let self, self.state.isCaller, from == self.state.peerId else { return }
            if accepted { self.state.stage = .connecting; self.createOfferAndSend() }
            else { self.cleanup(.ended) }
        }.store(in: &cancellables)

        socket.callOffer.receive(on: DispatchQueue.main).sink { [weak self] (from, sdp) in
            guard let self, from == self.state.peerId, let pc = self.pc else { return }
            let desc = RTCSessionDescription(type: .offer, sdp: sdp)
            pc.setRemoteDescription(desc) { [weak self] err in
                guard let self, err == nil else { return }
                self.remoteDescSet = true
                self.drainIce()
                self.createAnswerAndSend()
            }
        }.store(in: &cancellables)

        socket.callAnswer.receive(on: DispatchQueue.main).sink { [weak self] (from, sdp) in
            guard let self, from == self.state.peerId, let pc = self.pc else { return }
            let desc = RTCSessionDescription(type: .answer, sdp: sdp)
            pc.setRemoteDescription(desc) { [weak self] err in
                guard let self, err == nil else { return }
                self.remoteDescSet = true
                self.drainIce()
            }
        }.store(in: &cancellables)

        socket.callIce.receive(on: DispatchQueue.main).sink { [weak self] (from, candidate, sdpMid, idx) in
            guard let self, from == self.state.peerId else { return }
            let cand = RTCIceCandidate(sdp: candidate, sdpMLineIndex: idx, sdpMid: sdpMid)
            if self.remoteDescSet { self.pc?.add(cand) } else { self.pendingIce.append(cand) }
        }.store(in: &cancellables)

        socket.callEnd.receive(on: DispatchQueue.main).sink { [weak self] from in
            guard let self, from == self.state.peerId else { return }
            self.cleanup(.ended)
        }.store(in: &cancellables)
    }

    private func drainIce() {
        pendingIce.forEach { pc?.add($0) }
        pendingIce.removeAll()
    }

    private func createOfferAndSend() {
        guard let pc = pc else { return }
        pc.offer(for: mediaConstraints()) { [weak self] desc, err in
            guard let self, let desc, err == nil else { return }
            pc.setLocalDescription(desc) { _ in }
            self.socket.emitCallOffer(to: self.state.peerId, sdp: desc.sdp)
        }
    }

    private func createAnswerAndSend() {
        guard let pc = pc else { return }
        pc.answer(for: mediaConstraints()) { [weak self] desc, err in
            guard let self, let desc, err == nil else { return }
            pc.setLocalDescription(desc) { _ in }
            self.socket.emitCallAnswer(to: self.state.peerId, sdp: desc.sdp)
        }
    }

    private func mediaConstraints() -> RTCMediaConstraints {
        RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "true",
                "OfferToReceiveVideo": state.isVideo ? "true" : "false",
            ],
            optionalConstraints: nil
        )
    }

    // MARK: - WebRTC 构建
    private func createPeerConnection() {
        remoteDescSet = false
        pendingIce.removeAll()
        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc = factory.peerConnection(with: config, constraints: constraints, delegate: self)
    }

    private func createLocalTracks(video: Bool) {
        guard let pc = pc else { return }
        // 音频
        let audioSource = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let audio = factory.audioTrack(with: audioSource, trackId: "audio0")
        localAudioTrack = audio
        pc.add(audio, streamIds: ["stream0"])
        // 视频
        if video {
            let videoSource = factory.videoSource()
            videoCapturer = RTCCameraVideoCapturer(delegate: videoSource)
            let track = factory.videoTrack(with: videoSource, trackId: "video0")
            localVideoTrack = track
            pc.add(track, streamIds: ["stream0"])
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

    // MARK: - 清理
    private func cleanup(_ finalStage: CallStage) {
        cancelCallTimeout()                 // 取消未接听超时，避免正常挂断被误判超时
        videoCapturer?.stopCapture()
        videoCapturer = nil
        localVideoTrack = nil
        remoteVideoTrack = nil
        localAudioTrack = nil
        pc?.close()
        pc = nil
        remoteDescSet = false
        pendingIce.removeAll()
        deactivateAudioSession()            // 释放通话音频会话
        state.stage = finalStage
        state.remoteVideoActive = false
    }
}

// MARK: - RTCPeerConnectionDelegate
extension CallManager: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        let peer = state.peerId
        socket.emitCallIce(to: peer, candidate: candidate.sdp, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex)
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams mediaStreams: [RTCMediaStream]) {
        if let track = rtpReceiver.track as? RTCVideoTrack {
            DispatchQueue.main.async {
                self.remoteVideoTrack = track
                self.state.remoteVideoActive = true
            }
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        DispatchQueue.main.async {
            switch newState {
            case .connected, .completed:
                self.cancelCallTimeout()        // 已接通，撤销未接听超时
                if self.state.stage != .ended { self.state.stage = .connected }
            default: break
            }
        }
    }

    // 必需的其余回调（无操作）
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
