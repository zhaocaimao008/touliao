import Foundation
import Combine
import AVFoundation
import WebRTC
import UIKit

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
    var speakerOn: Bool = false       // 2026-10-02：扬声器/听筒切换；群视频默认扬声器
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
        /// 完美协商：本端(polite)回滚了自己的 offer 去应答对方，应答完成后须补发本端 offer
        var pendingRenegotiation = false
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
    private var callIdentityEpoch: UInt64?
    private var participatingCallId = ""
    private var participatingIdentityEpoch: UInt64?
    // Q06 全修：group_call:resume 必须证明持有它，光凭 callId+userId 不再够（同账号旁观
    // 设备不能在断线宽限期内抢注）。gcStarted/gcPeers 里签发，cleanup() 清空。
    private var participatingResumeToken: String?

    /// 建群通话/加入后的连接超时；始终停在 .connecting（服务端未回 started/peers）则自动结束。
    private var connectTimeoutTask: Task<Void, Never>?
    private let connectTimeoutSeconds: UInt64 = 45

    /// 本类是否经 configureAudioSession 成功 setActive(true)；deactivate 只在为 true 时停用（激活计数平衡）
    private var didActivateSession = false
    /// 后台被打断时争取执行时间；打断结束/回前台/挂断时结束
    private let interruptionBgTask = CallBackgroundTask(name: "touliao.groupcall.interruption")
    /// connecting 阶段后台保活；服务端确认(started/peers)或挂断时结束
    private let connectingBgTask = CallBackgroundTask(name: "touliao.groupcall.connecting")

    private override init() {
        RTCInitFieldTrialDictionary(callFieldTrials)   // 须在创建 factory 之前
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
        super.init()
        observeSignaling()
        observeAudioInterruptions()
        // 距离传感器/防锁屏随群通话状态自动开关，结束时复原
        $state
            .receive(on: DispatchQueue.main)
            .sink { _ in CallAudioSupport.refreshDeviceGuards() }
            .store(in: &cancellables)
    }

    // ICE restart 参数(与四端统一):防抖 3s / 恢复窗口 15s / 最大 3 次
    private let ICE_RESTART_DEBOUNCE_MS: UInt64 = 3_000_000_000
    private let ICE_RESTART_WINDOW_MS: UInt64 = 15_000_000_000
    private let ICE_RESTART_MAX = 3

    func activate() {}

    /// 群通话进行中（连接中/通话中）。供 1v1 互斥判断。
    var isBusy: Bool { state.stage == .connecting || state.stage == .connected }

    /// 本地媒体已建立且处于通话流程中
    private var hasActiveMedia: Bool {
        localAudioTrack != nil && (state.stage == .connecting || state.stage == .connected)
    }

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
            if !didActivateSession {
                try session.setActive(true)
                didActivateSession = true
            }
            // 群视频默认扬声器（多人看屏场景），群语音默认听筒（与 1v1 一致）
            if state.isVideo { do { try session.overrideOutputAudioPort(.speaker) } catch { print("[GroupCall] 扬声器路由失败: \(error.localizedDescription)") } }
        } catch {
            // 配置失败不阻断通话；WebRTC 兜底默认会话
            print("[GroupCall] 配置通话音频会话失败: \(error.localizedDescription)")
        }
        session.unlockForConfiguration()
        state.speakerOn = state.isVideo
    }

    /// 通话结束释放音频会话，交还系统。只有本类激活过才停用（与 configureAudioSession 成对）。
    private func deactivateAudioSession() {
        state.speakerOn = false
        guard didActivateSession else { return }
        didActivateSession = false
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do { try session.overrideOutputAudioPort(.none) } catch { print("[GroupCall] 恢复默认路由失败: \(error.localizedDescription)") }
        do { try session.setActive(false) } catch { print("[GroupCall] 会话停用失败: \(error.localizedDescription)") }
        session.unlockForConfiguration()
    }

    /// 打断处理（与 CallManager 同策略，2026-10-02 新增——此前群通话完全没有打断处理）：
    /// 打断结束/媒体服务重置/回前台时只恢复会话参数与扬声器路由，不 setActive（WebRTC 自身负责恢复音频单元）；
    /// 后台被打断时申请 background task；路由变化冲掉扬声器 override 时补回。
    private func observeAudioInterruptions() {
        let center = NotificationCenter.default
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:
                if self.hasActiveMedia, UIApplication.shared.applicationState != .active {
                    self.interruptionBgTask.begin()
                }
            case .ended:
                self.restoreAudioSessionIfInCall()
                self.interruptionBgTask.end()
            @unknown default:
                break
            }
        }
        center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            self?.restoreAudioSessionIfInCall()
        }
        center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.restoreAudioSessionIfInCall()
            self.interruptionBgTask.end()
        }
        center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let self, self.hasActiveMedia, self.state.speakerOn,
                  CallAudioSupport.shouldReapplySpeaker(note) else { return }
            CallAudioSupport.forceSpeaker(tag: "[GroupCall]")
        }
    }

    private func restoreAudioSessionIfInCall() {
        guard hasActiveMedia else { return }
        CallAudioSupport.restoreCallConfiguration(speakerOn: state.speakerOn, tag: "[GroupCall]")
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
        // 1v1 与群通话互斥：1v1 通话中不发起（入口 ChatViewModel 已拦截并提示）
        guard !CallManager.shared.isBusy else { print("[GroupCall] 1v1 通话中，拒绝发起群通话"); return }
        let identityEpoch = KeychainStore.shared.snapshot().identityEpoch
        callIdentityEpoch = identityEpoch
        pendingInvite = nil
        state = GroupCallState(stage: .connecting, conversationId: conversationId, isVideo: video)
        startConnectTimeout()                   // 连接超时自动结束
        connectingBgTask.begin()                // 连接阶段后台保活（服务端确认/挂断时结束）
        Task { @MainActor in
            await refreshIceServers()
            guard callIdentityEpoch == identityEpoch,
                  KeychainStore.shared.snapshot().identityEpoch == identityEpoch,
                  state.stage != .ended
            else { return }
            configureAudioSession()             // 建流前配好通话音频会话
            createLocalMedia(video: video)
            socket.emitGroupCallStart(conversationId: conversationId, type: video ? "video" : "audio")
        }
    }

    func join(callId: String, conversationId: String, video: Bool) {
        guard state.stage == .idle || state.stage == .ended else { return }
        // 1v1 与群通话互斥：1v1 通话中不加入（邀请横幅在 1v1 通话中已隐藏）
        guard !CallManager.shared.isBusy else { print("[GroupCall] 1v1 通话中，拒绝加入群通话"); return }
        let identityEpoch = KeychainStore.shared.snapshot().identityEpoch
        callIdentityEpoch = identityEpoch
        pendingInvite = nil
        state = GroupCallState(stage: .connecting, callId: callId, conversationId: conversationId, isVideo: video)
        startConnectTimeout()                   // 连接超时自动结束
        connectingBgTask.begin()                // 连接阶段后台保活（服务端确认/挂断时结束）
        Task { @MainActor in
            await refreshIceServers()
            guard callIdentityEpoch == identityEpoch,
                  KeychainStore.shared.snapshot().identityEpoch == identityEpoch,
                  state.stage != .ended
            else { return }
            configureAudioSession()             // 建流前配好通话音频会话
            createLocalMedia(video: video)
            socket.emitGroupCallJoin(callId: callId)
        }
    }

    func hangup() {
        if !state.callId.isEmpty { socket.emitGroupCallLeave(callId: state.callId) }
        cleanup()
    }

    func resetForAccountChange() {
        guard state.stage != .idle && state.stage != .ended else { return }
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
    /// 切换扬声器/听筒（2026-10-02 新增，同 CallManager.toggleSpeaker 走 RTCAudioSession 锁）。
    func toggleSpeaker() {
        let enabled = !state.speakerOn
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do { try session.overrideOutputAudioPort(enabled ? .speaker : .none) } catch { print("[GroupCall] 切换输出路由失败: \(error.localizedDescription)") }
        session.unlockForConfiguration()
        state.speakerOn = enabled
    }
    /// B-1（2026-09-05）：语音加入者升级视频（镜像 Web GroupCallModal.upgradeToVideo）。
    /// 补视频轨（已存在则复用，建轨/采集与 1v1 CallManager.toggleVideo 同款）后对每条已建立
    /// pc add 轨并逐个重协商 offer（mesh 每 peer 一份 offer，走群既有 sendOffer 路径）。
    /// 对端 answer 侧无需改动：unified plan 下 setRemoteDescription 按 remote offer 自动
    /// 创建 video transceiver，createAnswer 必须应答（recvonly），onRemoteVideo 自然出画。
    /// 反向（升级后关摄像头）走 toggleCamera 原开关逻辑，不改。
    func upgradeToVideo() {
        guard !state.isVideo, state.stage == .connected || state.stage == .connecting else { return }
        if localVideoTrack == nil {
            let videoSource = factory.videoSource()
            videoCapturer = RTCCameraVideoCapturer(delegate: videoSource)
            localVideoTrack = factory.videoTrack(with: videoSource, trackId: "g_video")
        }
        startCapture(position: .front)
        // 先置 isVideo：mediaConstraints() 按 it 决定 OfferToReceiveVideo，UI 视频格也按它渲染
        state.isVideo = true
        state.cameraEnabled = true
        for (pid, entry) in peers {
            entry.pc.add(localVideoTrack!, streamIds: ["g_stream"])
            sendOffer(to: pid, entry: entry)
        }
        reapplyGroupCaps()   // 升级新增 video sender，对已连接 pc 立即按人数施加码率上限
    }
    func switchCamera() {
        guard let capturer = videoCapturer else { return }
        let current = capturer.captureSession.inputs.compactMap { ($0 as? AVCaptureDeviceInput)?.device.position }.first ?? .front
        startCapture(position: current == .front ? .back : .front)
    }
    func consumeEnded() { if state.stage == .ended { state = GroupCallState() } }

    // MARK: - 信令
    private func observeSignaling() {
        socket.status
            .filter { $0 == .connected }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self,
                      self.state.stage != .idle,
                      self.state.stage != .ended,
                      CallSignalMatcher.canResume(
                        activeCallId: self.state.callId,
                        participatingCallId: self.participatingCallId,
                        participatingIdentityEpoch: self.participatingIdentityEpoch,
                        currentIdentityEpoch: KeychainStore.shared.snapshot().identityEpoch
                      )
                else { return }
                self.socket.emitGroupCallResume(callId: self.state.callId, resumeToken: self.participatingResumeToken)
                // 断线期间发出的 offer 可能丢失：resume 之后，仍停在 have-local-offer 的 peer 重发本端 offer
                for (pid, entry) in self.peers where entry.pc.signalingState == .haveLocalOffer {
                    guard let local = entry.pc.localDescription else { continue }
                    print("[GroupCall] 信令重连后向 \(pid) 重发本端 offer")
                    self.socket.emitGroupCallOffer(callId: self.state.callId, to: pid, sdp: local.sdp)
                }
            }
            .store(in: &cancellables)

        socket.gcInvite.receive(on: DispatchQueue.main).sink { [weak self] inv in
            guard let self else { return }
            if self.state.stage == .connecting || self.state.stage == .connected { return }
            self.pendingInvite = GroupCallInvite(callId: inv.callId, conversationId: inv.conversationId, type: inv.type, from: inv.from, fromName: inv.fromName)
        }.store(in: &cancellables)

        socket.gcStarted.receive(on: DispatchQueue.main).sink { [weak self] (callId, _, resumeToken) in
            guard let self,
                  let identityEpoch = self.callIdentityEpoch,
                  KeychainStore.shared.snapshot().identityEpoch == identityEpoch,
                  self.state.stage != .ended
            else { return }
            self.participatingCallId = callId
            self.participatingIdentityEpoch = identityEpoch
            self.participatingResumeToken = resumeToken
            self.cancelConnectTimeout()         // 服务端已确认，撤销连接超时
            self.connectingBgTask.end()
            if self.state.connectedAt == nil { self.state.connectedAt = Date() }
            self.state.stage = .connected; self.state.callId = callId
        }.store(in: &cancellables)

        socket.gcPeers.receive(on: DispatchQueue.main).sink { [weak self] (callId, _, peers, resumeToken) in
            guard let self,
                  let identityEpoch = self.callIdentityEpoch,
                  KeychainStore.shared.snapshot().identityEpoch == identityEpoch
            else { return }
            if !self.state.callId.isEmpty && callId != self.state.callId { return }
            self.participatingCallId = callId
            self.participatingIdentityEpoch = identityEpoch
            self.participatingResumeToken = resumeToken
            self.cancelConnectTimeout()         // 服务端已确认，撤销连接超时
            self.connectingBgTask.end()
            if self.state.connectedAt == nil { self.state.connectedAt = Date() }
            self.state.stage = .connected; self.state.callId = callId
            peers.forEach { _ = self.peerFor($0) }   // answerer：预建 PC 等 offer
            self.state.participants = Array(self.peers.keys)
        }.store(in: &cancellables)

        socket.gcPeerJoined.receive(on: DispatchQueue.main).sink { [weak self] (callId, userId) in
            guard let self, callId == self.state.callId, let entry = self.peerFor(userId) else { return }
            self.state.participants = Array(self.peers.keys)
            self.sendOffer(to: userId, entry: entry)
        }.store(in: &cancellables)

        socket.gcOffer.receive(on: DispatchQueue.main).sink { [weak self] (callId, from, sdp) in
            guard let self, callId == self.state.callId, let entry = self.peerFor(from) else { return }
            self.state.participants = Array(self.peers.keys)
            self.handleRemoteOffer(sdp: sdp, from: from, entry: entry)
        }.store(in: &cancellables)

        socket.gcAnswer.receive(on: DispatchQueue.main).sink { [weak self] (callId, from, sdp) in
            // callId 校验（同 offer 路径）：旧通话/串话的迟到信令直接丢弃
            guard let self, callId == self.state.callId, let entry = self.peers[from] else { return }
            // 只有本端发出 offer 等应答时才接受；撞车回滚/重复到达的迟到 answer 忽略（不移除 peer）
            guard entry.pc.signalingState == .haveLocalOffer else {
                print("[GroupCall] 非 have-local-offer 状态收到 \(from) 的 answer，忽略")
                return
            }
            entry.pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [weak self] err in
                if let err { print("[GroupCall] 设置 \(from) 的远端 answer 失败: \(err.localizedDescription)"); return }
                DispatchQueue.main.async {
                    guard let self, self.peers[from] === entry else { return }
                    entry.remoteDescSet = true; self.drainIce(from)
                }
            }
        }.store(in: &cancellables)

        socket.gcIce.receive(on: DispatchQueue.main).sink { [weak self] (callId, from, candidate, sdpMid, idx) in
            guard let self, callId == self.state.callId, let entry = self.peers[from] else { return }
            let cand = RTCIceCandidate(sdp: candidate, sdpMLineIndex: idx, sdpMid: sdpMid)
            if entry.remoteDescSet { entry.pc.add(cand) } else { entry.pendingIce.append(cand) }
        }.store(in: &cancellables)

        socket.gcPeerLeft.receive(on: DispatchQueue.main).sink { [weak self] (callId, userId) in
            guard let self, callId == self.state.callId else { return }
            self.removePeer(userId)
        }.store(in: &cancellables)

        socket.gcError.receive(on: DispatchQueue.main).sink { [weak self] _ in
            guard let self else { return }
            if self.state.stage != .connected { self.cleanup() }
        }.store(in: &cancellables)

        // 服务端强制结束（如超过时长上限）：无条件结束本地通话并回收资源
        socket.gcEnded.receive(on: DispatchQueue.main).sink { [weak self] (callId, _) in
            guard let self else { return }
            guard self.state.stage != .idle,
                  CallSignalMatcher.matchesTerminal(
                    activeCallId: self.state.callId,
                    eventCallId: callId,
                    callIdentityEpoch: self.callIdentityEpoch,
                    currentIdentityEpoch: KeychainStore.shared.snapshot().identityEpoch
                  )
            else { return }
            self.cleanup()
        }.store(in: &cancellables)
    }

    /// 建 offer(含弱网 SDP 调优 + A-2 H264 优先)并通过信令发给指定 peer；新成员加入和 ICE restart 重协商共用。
    private func sendOffer(to peerId: String, entry: PeerEntry) {
        entry.pc.offer(for: mediaConstraints()) { [weak self] desc, err in
            guard let self, let desc, err == nil else { return }
            let tuned = RTCSessionDescription(type: desc.type, sdp: tuneSdpForCall(desc.sdp))
            entry.pc.setLocalDescription(tuned) { err in
                if let err { print("[GroupCall] 设置对 \(peerId) 的本端 offer 失败: \(err.localizedDescription)") }
            }
            self.socket.emitGroupCallOffer(callId: self.state.callId, to: peerId, sdp: tuned.sdp)
        }
    }

    /// 完美协商（四端统一）：每个 peer 按 userId 字符串比较，较小的一方 impolite（且负责 ICE restart），
    /// 较大的一方 polite。取不到本端 id 时按空串处理（视为 impolite），不影响首次协商（首次 offer 固定由既有成员发出）。
    private func isImpolite(toward peerId: String) -> Bool {
        let me = AccountStore.shared.activeId() ?? ""
        return me < peerId
    }

    /// 收到 offer 时本端正处于 have-local-offer（双方同时重协商撞车，如双方同时升级视频/restart）：
    /// polite 先 rollback 本端 offer 再应答（应答完补发本端 offer）；impolite 忽略该 offer。
    private func handleRemoteOffer(sdp: String, from: String, entry: PeerEntry) {
        let desc = RTCSessionDescription(type: .offer, sdp: sdp)
        guard entry.pc.signalingState == .haveLocalOffer else {
            applyRemoteOffer(desc, from: from, entry: entry)
            return
        }
        guard !isImpolite(toward: from) else {
            print("[GroupCall] 与 \(from) offer 撞车：本端 impolite，忽略对方 offer")
            return
        }
        print("[GroupCall] 与 \(from) offer 撞车：本端 polite，回滚本端 offer 后应答")
        entry.pendingRenegotiation = true
        entry.pc.setLocalDescription(RTCSessionDescription(type: .rollback, sdp: "")) { [weak self] err in
            DispatchQueue.main.async {
                guard let self, self.peers[from] === entry else { return }
                if let err {
                    print("[GroupCall] 回滚对 \(from) 的本端 offer 失败: \(err.localizedDescription)")
                    entry.pendingRenegotiation = false
                    return
                }
                self.applyRemoteOffer(desc, from: from, entry: entry)
            }
        }
    }

    private func applyRemoteOffer(_ desc: RTCSessionDescription, from: String, entry: PeerEntry) {
        entry.pc.setRemoteDescription(desc) { [weak self] err in
            if let err { print("[GroupCall] 设置 \(from) 的远端 offer 失败: \(err.localizedDescription)"); return }
            DispatchQueue.main.async {
                guard let self, self.peers[from] === entry else { return }
                entry.remoteDescSet = true; self.drainIce(from)
                entry.pc.answer(for: self.mediaConstraints()) { [weak self] desc, err in
                    guard let self, let desc, err == nil else { return }
                    // A-2：弱网调优 + H264 优先（setLocalDescription 前改本端 sdp）
                    let tuned = RTCSessionDescription(type: desc.type, sdp: tuneSdpForCall(desc.sdp))
                    entry.pc.setLocalDescription(tuned) { [weak self] err in
                        if let err { print("[GroupCall] 设置对 \(from) 的本端 answer 失败: \(err.localizedDescription)") }
                        DispatchQueue.main.async {
                            // 撞车回滚后应答完成 → 补发本端被回滚掉的重协商 offer
                            guard let self, err == nil, self.peers[from] === entry, entry.pendingRenegotiation else { return }
                            entry.pendingRenegotiation = false
                            self.sendOffer(to: from, entry: entry)
                        }
                    }
                    self.socket.emitGroupCallAnswer(callId: self.state.callId, to: from, sdp: tuned.sdp)
                }
            }
        }
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
                // A-3：本 pc 刚转 connected → 按最新已连接人数对全部已连接 pc（含本条）重放码率/降档
                self.reapplyGroupCaps()
            case .disconnected:
                // 短时探测间隙:3s 防抖后再重启,避免无谓重协商
                guard let entry = self.peers[peerId] else { return }
                // 四端统一：只有 impolite 一方(userId 较小)发起 restart；polite 一方只应答，开看门狗兜底
                guard self.isImpolite(toward: peerId) else {
                    self.startPeerRecoverWatchdog(peerId, entry: entry)
                    return
                }
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
                if !self.isImpolite(toward: peerId) {
                    self.startPeerRecoverWatchdog(peerId, entry: entry)   // polite 不 restart
                } else if entry.iceRestartCount == 0 && entry.iceRestartRecoverTask == nil {
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
        sendOffer(to: peerId, entry: entry)   // restartIce() 只打标记，必须实际重协商 offer 对方才会重新打通
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

    /// polite 一方的恢复看门狗：不主动 restart，等对端(impolite)的 restart offer；
    /// 窗口 = 对端用满全部重试的最坏时长 + 2s 余量，到期仍 disconnected/failed → 移除该 peer。
    private func startPeerRecoverWatchdog(_ peerId: String, entry: PeerEntry) {
        guard entry.iceRestartRecoverTask == nil else { return }
        let total = ICE_RESTART_DEBOUNCE_MS + ICE_RESTART_WINDOW_MS * UInt64(ICE_RESTART_MAX) + 2_000_000_000
        entry.iceRestartRecoverTask = Task { @MainActor [weak self, weak entry] in
            try? await Task.sleep(nanoseconds: total)
            guard let self, let entry, !Task.isCancelled else { return }
            entry.iceRestartRecoverTask = nil
            let st = entry.pc.iceConnectionState
            if (st == .disconnected || st == .failed), self.peers[peerId] === entry {
                self.removePeer(peerId)
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
        // 2026-09-05 修复:视频模糊根因之一——原逻辑只挑 >=640(约 480p)里最小的一个。
        // 优先挑 >=1280(约 720p)里最小的一个;没有 720p 及以上格式的设备再退回旧逻辑。
        let sortedFormats = formats.sorted {
            let d1 = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            let d2 = CMVideoFormatDescriptionGetDimensions($1.formatDescription)
            return d1.width * d1.height < d2.width * d2.height
        }
        let format = sortedFormats.first(where: { CMVideoFormatDescriptionGetDimensions($0.formatDescription).width >= 1280 })
            ?? sortedFormats.first(where: { CMVideoFormatDescriptionGetDimensions($0.formatDescription).width >= 640 })
            ?? formats.last
        guard let format else { return }
        let fps = format.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 30
        capturer.startCapture(with: device, format: format, fps: Int(min(fps, 30)))
    }

    /// N1+A-3：视频发送参数。maxBps=发送码率上限（群 mesh 按已连接人数传入，见
    /// [reapplyGroupCaps]）；degrade=true 时对 encodings[0] 叠加 2 倍降分辨率压 CPU/带宽，
    /// false 时显式清掉该字段（人数回落恢复全分辨率）。仅影响 video sender。
    /// （1v1 CallManager 的 capVideoBitrate 固定 2.5M 不降档，与此互不影响。）
    /// API 依据与 CallManager.capVideoBitrate 同：RTCRtpSender.parameters 为 get/set 属性，
    /// scaleResolutionDownBy 与 maxBitrateBps 同为 nullable NSNumber（RTCRtpEncodingParameters）。
    private func capVideoBitrate(_ pc: RTCPeerConnection, maxBps: Int = 2_500_000, degrade: Bool = false) {
        for sender in pc.senders where sender.track?.kind == "video" {
            let p = sender.parameters
            if let enc = p.encodings.first {
                enc.maxBitrateBps = NSNumber(value: maxBps)
                enc.scaleResolutionDownBy = degrade ? NSNumber(value: 2) : nil
                sender.parameters = p
            }
        }
    }

    // A-3（2026-09-05）：mesh 群通话按当前已连接 peer 数 n 对全部已连接 pc 重放视频码率/
    // 降档——N 路同时编码共享同一份 CPU/上行带宽，人越多每路预算必须越低：
    //   ≤2（与 1v1 默认一致）2.5M / 3 人 1.6M / 4 人 1.2M / ≥5 人 1.0M；
    //   n≥4 叠加 scaleResolutionDownBy=2 降编码负载，人数回落靠 degrade=false 清掉恢复。
    // 触发点：任一 peer ICE connected / removePeer / 语音→视频升级。只对已连接的 pc 施加
    // ——未协商完的 sender 上设参数可能失败，且连上才真正占编码资源。
    private func reapplyGroupCaps() {
        func connected(_ entry: PeerEntry) -> Bool {
            let st = entry.pc.iceConnectionState
            return st == .connected || st == .completed
        }
        let n = peers.values.filter(connected).count
        let maxBps: Int
        switch n {
        case ...2: maxBps = 2_500_000
        case 3: maxBps = 1_600_000
        case 4: maxBps = 1_200_000
        default: maxBps = 1_000_000
        }
        let degrade = n >= 4
        for entry in peers.values where connected(entry) {
            capVideoBitrate(entry.pc, maxBps: maxBps, degrade: degrade)
        }
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
        reapplyGroupCaps()   // A-3：人数减少 → 剩余 peer 按新人数重放码率/降档（撤销降档也靠它）
    }

    private func mediaConstraints() -> RTCMediaConstraints {
        RTCMediaConstraints(
            mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": state.isVideo ? "true" : "false"],
            optionalConstraints: nil
        )
    }

    /// 弱网调优（2026-09-02）：Opus inband FEC + 码率上限 64kbps + 单声道（与 CallManager 一致）。
    private func cleanup() {
        callIdentityEpoch = nil
        participatingCallId = ""
        participatingIdentityEpoch = nil
        participatingResumeToken = nil
        cancelConnectTimeout()              // 取消连接超时，避免泄漏
        interruptionBgTask.end()            // 结束后台保活任务
        connectingBgTask.end()
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
