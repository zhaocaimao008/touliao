import Foundation
import Combine
import AVFoundation
import WebRTC
import UIKit
import UserNotifications

enum CallStage { case idle, outgoing, incoming, connecting, connected, ended }

struct CallState {
    var stage: CallStage = .idle
    var peerId: String = ""
    var peerName: String = ""
    var isVideo: Bool = false
    var isCaller: Bool = false
    var callId: String = ""             // 服务端通话 id，随 accept/reject/hangup 回传做过期应答校验
    var micEnabled: Bool = true
    var cameraEnabled: Bool = true
    var speakerOn: Bool = false   // 2026-08-29 语音通话审计新增：此前完全没有扬声器切换能力
    var remoteVideoActive: Bool = false
    var timedOut: Bool = false          // 主叫未接听超时 → 结束页提示"对方未接听"
    var networkEnded: Bool = false      // 网络断开/ICE 失败 → 结束页提示"网络已断开"
    var connectedAt: Date?              // 接通时刻，用于计算通话时长(mm:ss)
    var endedAt: Date?                  // 结束时刻，用于在结束页定格总时长
    /// 2026-08-29新增：通话小窗——true时CallHostView渲染悬浮小窗而非全屏通话界面，
    /// 用户可退回App其它页面继续操作，媒体流不受影响(PeerConnection不因UI切换而重建)。
    var isMinimized: Bool = false
    /// 2026-09-02新增：通话质量指示（getStats 2s 采样）。""=未采样 / good=优 / medium=中 / poor=差
    var callQuality: String = ""
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
    private var disconnectGraceTask: Task<Void, Never>?
    // ICE restart 自愈(网络切换 Wi-Fi↔4G):disconnected 3s 防抖 → restartIce → 15s 窗口 → 最多 3 次 → 挂断。
    // 信令复用现有 call:offer/answer/ice(后端纯转发零改动),对端收到重协商 offer 走现有应答逻辑。
    private var iceRestartCount = 0
    private var iceRestartDebounceTask: Task<Void, Never>?
    private var iceRestartRecoverTask: Task<Void, Never>?
    private let ICE_RESTART_DEBOUNCE_MS: UInt64 = 3_000_000_000
    private let ICE_RESTART_WINDOW_MS: UInt64 = 15_000_000_000
    private let ICE_RESTART_MAX = 3
    private let callTimeoutSeconds: UInt64 = 45

    /// 通话提示音（回铃/接通），与 Android ToneGenerator 对齐。
    private let tonePlayer = CallTonePlayer()

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
            // 默认听筒（语音通话习惯），视频通话默认扬声器更符合使用场景
            if state.isVideo { do { try session.overrideOutputAudioPort(.speaker) } catch { print("[Call] 扬声器路由失败: \(error.localizedDescription)") } }
        } catch {
            // 配置失败不阻断通话；WebRTC 兜底默认会话
        }
        session.unlockForConfiguration()
        state.speakerOn = state.isVideo
    }

    /// 通话结束释放音频会话，交还系统（便于语音消息/系统音恢复常规路由）。
    private func deactivateAudioSession() {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do { try session.overrideOutputAudioPort(.none) } catch { print("[Call] 恢复默认路由失败: \(error.localizedDescription)") }
        do { try session.setActive(false) } catch { print("[Call] 会话停用失败: \(error.localizedDescription)") }
        session.unlockForConfiguration()
        state.speakerOn = false
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
            if !self.state.peerId.isEmpty { self.socket.emitCallEnd(to: self.state.peerId, callId: self.state.callId) }
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
            tonePlayer.playRingback()           // 会话就绪后→主叫回铃音（接通/挂断时停）
            createPeerConnection()
            createLocalTracks(video: video)
            socket.emitCallRequest(to: peerId, type: video ? "video" : "audio", callerName: callerName)
        }
    }

    func accept() {
        guard state.stage == .incoming else { return }
        let peerId = state.peerId
        let callId = state.callId
        clearIncomingCallNotifications(from: peerId)   // 接听后清掉该来电的通知，避免用户误触过期通知
        state.stage = .connecting
        Task { @MainActor in
            await refreshIceServers()
            guard state.stage != .ended else { return }
            configureAudioSession()             // 建流前配好通话音频会话
            createPeerConnection()
            createLocalTracks(video: state.isVideo)
            socket.emitCallResponse(to: peerId, accepted: true, callId: callId)
        }
    }

    func reject() {
        // 必须仅在真正处于来电态时才执行：若当前是已建立的通话（如过期通知的 incomingFromPush
        // 因 stage!=idle/ended 未覆盖 state），无守卫会让过期 DECLINE 静默拒接/拆毁一通不相关的活跃通话（Hermes F1）。
        guard state.stage == .incoming else { return }
        if !state.peerId.isEmpty { socket.emitCallResponse(to: state.peerId, accepted: false, callId: state.callId) }
        VoipCallManager.shared.endActiveCall()   // 同步收尾 CallKit 来电界面
        cleanup(.ended)
    }

    /// 拒接来电并打开与该用户的私聊会话（WhatsApp 式「拒接后回复」）
    func rejectAndReply() {
        guard state.stage == .incoming else { return }
        let peerId = state.peerId
        reject()
        guard !peerId.isEmpty else { return }
        Task {
            do {
                let conversationId = try await ContactRepository.shared.createPrivate(userId: peerId)
                NotificationCenter.default.post(
                    name: .vxinOpenConversation, object: nil,
                    userInfo: ["conversationId": conversationId]
                )
            } catch {
                // 会话打开失败静默（用户仍可手动进入会话）
            }
        }
    }

    func hangup() {
        if !state.peerId.isEmpty { socket.emitCallEnd(to: state.peerId, callId: state.callId) }
        VoipCallManager.shared.endActiveCall()   // 同步收尾 CallKit 通话界面
        cleanup(.ended)
    }

    /// 通话小窗：最小化/恢复全屏通话界面。只切UI呈现，不触碰PeerConnection/信令，
    /// 媒体流在最小化期间正常继续。
    func setMinimized(_ minimized: Bool) {
        state.isMinimized = minimized
    }

    func toggleMic() {
        let enabled = !state.micEnabled
        localAudioTrack?.isEnabled = enabled
        state.micEnabled = enabled
    }

    /// 切换扬声器/听筒。必须走 RTCAudioSession（同 configureAudioSession 的原因：WebRTC
    /// 持有音频会话，裸 AVAudioSession.overrideOutputAudioPort 会与其路由决策打架）。
    func toggleSpeaker() {
        let enabled = !state.speakerOn
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do { try session.overrideOutputAudioPort(enabled ? .speaker : .none) } catch { print("[Call] 切换输出路由失败: \(error.localizedDescription)") }
        session.unlockForConfiguration()
        state.speakerOn = enabled
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

    /// 重建 incoming 状态：用于通知 ANSWER/DECLINE 动作把 App 从后台/被杀状态拉起时，
    /// state 尚未由 socket.callIncoming 建立的情况。幂等：已在展示同一来电或通话中不覆盖。
    func incomingFromPush(from: String, callType: String, callerName: String, callId: String = "") {
        guard !from.isEmpty else { return }
        guard state.stage == .idle || state.stage == .ended else { return }
        state = CallState(stage: .incoming, peerId: from, peerName: callerName, isVideo: callType == "video", isCaller: false, callId: callId)
    }

    // MARK: - 信令
    private func observeSignaling() {
        socket.callIncoming.receive(on: DispatchQueue.main).sink { [weak self] (from, type, name, callId) in
            guard let self else { return }
            if self.state.stage != .idle && self.state.stage != .ended {
                self.socket.emitCallResponse(to: from, accepted: false, callId: callId); return
            }
            self.state = CallState(stage: .incoming, peerId: from, peerName: name, isVideo: type == "video", isCaller: false, callId: callId)
            // 锁屏/后台来电：App 不在前台时补弹本地通知（含接听/拒绝按钮），
            // 前台由来电邀请横幅 UI 展示，避免重复打扰。
            if UIApplication.shared.applicationState != .active {
                self.showIncomingCallNotification(from: from, callerName: name, callType: type, callId: callId)
            }
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
            VoipCallManager.shared.endActiveCall()   // 对方挂断时同步收尾 CallKit
            self.cleanup(.ended)
        }.store(in: &cancellables)

        // 对方切换语音↔视频：同步 UI（媒体流由对方重协商 offer 驱动）
        socket.callSwitchType.receive(on: DispatchQueue.main).sink { [weak self] evt in
            guard let self, evt.from == self.state.peerId, evt.callId == self.state.callId else { return }
            if self.state.stage == .connected || self.state.stage == .connecting {
                self.state.isVideo = (evt.type == "video")
            }
        }.store(in: &cancellables)
    }

    private func drainIce() {
        pendingIce.forEach { pc?.add($0) }
        pendingIce.removeAll()
    }

    /// 锁屏/后台来电本地通知：categoryIdentifier=INCOMING_CALL 对应 AppDelegate 注册的
    /// 接听/拒绝按钮；userInfo 携带 from/callType/callerName 供动作分支使用。
    private func showIncomingCallNotification(from: String, callerName: String, callType: String, callId: String) {
        let content = UNMutableNotificationContent()
        content.title = callerName.isEmpty ? "来电" : callerName
        content.body = callType == "video" ? "邀请你视频通话" : "邀请你语音通话"
        content.sound = .default
        content.categoryIdentifier = "INCOMING_CALL"
        content.userInfo = ["from": from, "callType": callType, "callerName": callerName, "callId": callId]

        let request = UNNotificationRequest(
            identifier: "incoming_call_\(from)",
            content: content,
            trigger: nil   // 立即触发
        )
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                print("[CallManager] 来电通知失败: \(error.localizedDescription)")
            }
        }
    }

    /// App 回前台时调用：清掉通知中心里所有残留的来电通知（不论 from）。
    /// 服务端超时静默（未接听 120s，E3 修复前）或用户从未交互的悬挂来电，只靠
    /// accept/reject/cleanup 触发的按 from 清理覆盖不到；前台来电本就改由横幅 UI 展示
    /// （见下方 observeSignaling），通知中心残留只会在数小时后被误触触发过期 DECLINE（Hermes F2）。
    func clearAllIncomingCallNotifications() {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { notifications in
            let ids = notifications
                .filter { $0.request.content.categoryIdentifier == "INCOMING_CALL" }
                .map { $0.request.identifier }
            guard !ids.isEmpty else { return }
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    /// 接听/拒绝/挂断/超时/被替换/通话结束时调用：清掉该来电已展示或待展示的本地/远程(APNs)通知，
    /// 避免用户之后误触已过期的通知——点击会经 incomingFromPush() 重建一个早已结束的通话并发出
    /// 过期应答（NOTIFY-002 F3）。pending 用固定 identifier 精确删；delivered（含 F1 新增的远程 APNs
    /// alert，其 identifier 由系统生成、并非 "incoming_call_<from>"）按 categoryIdentifier+from 匹配删。
    private func clearIncomingCallNotifications(from: String) {
        guard !from.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["incoming_call_\(from)"])
        center.getDeliveredNotifications { notifications in
            let ids = notifications.filter {
                $0.request.content.categoryIdentifier == "INCOMING_CALL" &&
                ($0.request.content.userInfo["from"] as? String) == from
            }.map { $0.request.identifier }
            guard !ids.isEmpty else { return }
            center.removeDeliveredNotifications(withIdentifiers: ids)
        }
    }

    private func createOfferAndSend() {
        guard let pc = pc else { return }
        pc.offer(for: mediaConstraints()) { [weak self] desc, err in
            guard let self, let desc, err == nil else { return }
            let tuned = RTCSessionDescription(type: desc.type, sdp: Self.tuneSdpForWeakNetwork(desc.sdp))
            pc.setLocalDescription(tuned) { _ in }
            self.socket.emitCallOffer(to: self.state.peerId, sdp: tuned.sdp)
        }
    }

    /// 通话中切换语音↔视频（2026-09-02）：补/删视频轨 + 重协商 offer + call:switch-type 告知对方。
    /// 对方由重协商 offer 驱动媒体流变化，switch-type 仅用于同步 UI。
    func toggleVideo() {
        guard let pc = pc, state.stage == .connected else { return }
        let nextVideo = !state.isVideo
        if nextVideo {
            // 语音→视频：补视频轨（已存在则复用——可能曾被 removeTrack/stopCapture）
            videoCapturer?.stopCapture()
            if localVideoTrack == nil {
                let videoSource = factory.videoSource()
                videoCapturer = RTCCameraVideoCapturer(delegate: videoSource)
                let track = factory.videoTrack(with: videoSource, trackId: "video0")
                localVideoTrack = track
                pc.add(track, streamIds: ["stream0"])
            } else {
                pc.add(localVideoTrack!, streamIds: ["stream0"])   // 可能曾被 removeTrack
                localVideoTrack?.isEnabled = true
            }
            startCapture(position: .front)
        } else {
            // 视频→语音：停采集 + 移除视频轨（capturer/track 引用保留，切回可复用）
            pc.senders.filter { $0.track?.kind == "video" }.forEach { sender in
                pc.removeTrack(sender)
            }
            videoCapturer?.stopCapture()
            localVideoTrack?.isEnabled = false
        }
        createOfferAndSend()   // 重协商（含 SDP 弱网调优）
        socket.emitCallSwitchType(to: state.peerId, type: nextVideo ? "video" : "audio", callId: state.callId)
        state.isVideo = nextVideo
    }

    private func createAnswerAndSend() {
        guard let pc = pc else { return }
        pc.answer(for: mediaConstraints()) { [weak self] desc, err in
            guard let self, let desc, err == nil else { return }
            let tuned = RTCSessionDescription(type: desc.type, sdp: Self.tuneSdpForWeakNetwork(desc.sdp))
            pc.setLocalDescription(tuned) { _ in }
            self.socket.emitCallAnswer(to: self.state.peerId, sdp: tuned.sdp)
        }
    }

    /// 弱网调优（2026-09-02）：Opus inband FEC + 码率上限 64kbps + 单声道。
    private static func tuneSdpForWeakNetwork(_ sdp: String) -> String {
        guard let range = sdp.range(of: #"a=rtpmap:(\d+) opus/48000/2"#, options: .regularExpression) else { return sdp }
        let pt = sdp[range].split(separator: " ").first!.split(separator: ":").last!
        let params = "useinbandfec=1;maxaveragebitrate=64000;stereo=0"
        let fmtpPattern = "a=fmtp:\(pt)[^\r\n]*"
        if let fmtpRange = sdp.range(of: fmtpPattern, options: .regularExpression) {
            let existing = sdp[fmtpRange].replacingOccurrences(of: "^a=fmtp:\(pt)\\s*", with: "", options: .regularExpression)
            var out: [String] = []
            var seen = Set<String>()
            let parts = (existing.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } + params.split(separator: ";").map(String.init))
            for p in parts {
                let key = p.split(separator: "=").first.map(String.init) ?? p
                if seen.insert(key).inserted { out.append(p) }
            }
            return sdp.replacingCharacters(in: fmtpRange, with: "a=fmtp:\(pt) \(out.joined(separator: ";"))")
        }
        // 无 fmtp 行（罕见）：在 rtpmap 后补一行
        if let lineRange = sdp.range(of: #"a=rtpmap:\d+ opus/48000/2\r?\n"#, options: .regularExpression) {
            return sdp.replacingCharacters(in: lineRange, with: sdp[lineRange] + "a=fmtp:\(pt) \(params)\r\n")
        }
        return sdp
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

    // MARK: - 通话质量指示（2026-09-02）：getStats 2s 采样 RTT/丢包率 → 优/中/差
    private var qualityTask: Task<Void, Never>?

    private func startQualitySampling() {
        qualityTask?.cancel()
        qualityTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.sampleQuality()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func sampleQuality() {
        guard let pc = pc else { return }
        pc.stats { [weak self] report in
            guard let self, let report else { return }
            var rtt: Double? = nil
            var lost: Int64 = 0, received: Int64 = 0
            for s in report.stats.values where s.type == "candidate-pair" || s.type == "inbound-rtp" {
                if s.type == "candidate-pair" {
                    // 注意：RTCStats.values 是 [String: NSObject]，Bool 实际桥接为 NSNumber
                    if let nominated = (s.values["nominated"] as? NSNumber)?.boolValue, nominated,
                       let state = s.values["state"] as? String, state == "succeeded" {
                        rtt = (s.values["currentRoundTripTime"] as? NSNumber)?.doubleValue.map { $0 * 1000 }
                    }
                } else if s.type == "inbound-rtp" {
                    if (s.values["kind"] as? String) == "audio" {
                        lost += (s.values["packetsLost"] as? NSNumber)?.int64Value ?? 0
                        received += (s.values["packetsReceived"] as? NSNumber)?.int64Value ?? 0
                    }
                }
            }
            let lossRate = received + lost > 0 ? Double(lost) / Double(received + lost) : 0
            let q: String
            if let rtt, rtt >= 500 { q = "poor" }
            else if let rtt, rtt >= 200 { q = "medium" }
            else if lossRate >= 0.08 { q = "poor" }
            else if lossRate >= 0.02 { q = "medium" }
            else { q = "good" }
            DispatchQueue.main.async {
                if self.state.callQuality != q { self.state.callQuality = q }
            }
        }
    }

    // MARK: - 清理
    private func cleanup(_ finalStage: CallStage) {
        qualityTask?.cancel(); qualityTask = nil          // 停质量采样
        cancelIceRestart()                          // 清 ICE restart 定时器/计数
        cancelDisconnectGrace()
        clearIncomingCallNotifications(from: state.peerId)  // 清掉该通话残留的来电通知，防止过期误触
        tonePlayer.stop()                   // 停回铃/接通音
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
        if state.connectedAt != nil && state.endedAt == nil { state.endedAt = Date() }
        state.stage = finalStage
        state.remoteVideoActive = false
        if finalStage == .ended {
            // 通话结束时强制回到全屏——若之前是小窗状态，CallMinimizedBubble不会挂载
            // CallView，之前挂在CallView.onChange里的自动consumeEnded就永远不会触发，
            // 小窗会卡死在"已结束"画面。改成manager自己调度，不依赖哪个UI正在显示。
            state.isMinimized = false
            let delay: UInt64 = state.timedOut ? 1_800_000_000 : 800_000_000
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: delay)
                self?.consumeEnded()
            }
        }
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
                self.cancelDisconnectGrace()    // 恢复连接则撤销断开宽限
                self.cancelIceRestart()         // restart 后恢复:清定时器 + 计数清零(可反复自愈)
                if self.state.stage != .ended {
                    if self.state.connectedAt == nil {
                        self.state.connectedAt = Date()
                        self.tonePlayer.playConnected()   // 首次接通→停回铃+接通提示音
                    }
                    self.state.stage = .connected
                }
                self.startQualitySampling()
            case .disconnected:
                // 锁屏/切后台/网络波动时 ICE 短暂 disconnected,数秒内自动恢复。
                // 3s 防抖 → restartIce() 自愈;15s 恢复窗口内未恢复则重试(最多 3 次)→ 挂断。
                // 不再像旧逻辑直接等 15s 挂断——网络切换(Wi-Fi↔4G)媒体断但信令活时能自愈。
                self.cancelDisconnectGrace()
                self.iceRestartDebounceTask?.cancel(); self.iceRestartDebounceTask = nil
                self.iceRestartRecoverTask?.cancel(); self.iceRestartRecoverTask = nil
                self.iceRestartDebounceTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: self?.ICE_RESTART_DEBOUNCE_MS ?? 3_000_000_000)
                    guard let self, !Task.isCancelled else { return }
                    self.tryIceRestart()
                }
            case .failed:
                // 首次 failed:给一次 restart 机会(可能临时网络黑洞);已重启过且非窗口期 → 结束并通知对方
                self.cancelDisconnectGrace()
                if self.iceRestartCount == 0 && self.iceRestartRecoverTask == nil {
                    self.tryIceRestart()
                } else if self.iceRestartRecoverTask == nil,
                          self.state.stage == .connected || self.state.stage == .connecting {
                    self.endCallByNetwork()
                }
            default: break
            }
        }
    }

    /// 撤销 ICE disconnected 宽限任务(恢复连接/正常挂断时调用)
    private func cancelDisconnectGrace() {
        disconnectGraceTask?.cancel()
        disconnectGraceTask = nil
    }

    // MARK: - ICE restart 自愈(网络切换)
    /// disconnected 3s 防抖后重启 ICE(重协商走现有 call:offer/answer,对端自动应答)
    private func tryIceRestart() {
        guard let pc else { return }
        if iceRestartCount >= ICE_RESTART_MAX {
            endCallByNetwork()
            return
        }
        iceRestartCount += 1
        pc.restartIce()
        iceRestartRecoverTask?.cancel()
        iceRestartRecoverTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: self?.ICE_RESTART_WINDOW_MS ?? 15_000_000_000)
            guard let self, !Task.isCancelled else { return }
            if let st = self.pc?.iceConnectionState,
               st == .disconnected || st == .failed {
                self.tryIceRestart()
            } else {
                self.iceRestartRecoverTask = nil
            }
        }
    }

    /// 网络不可恢复:通知对方 + 收尾(不能静默挂断)
    private func endCallByNetwork() {
        cancelIceRestart()
        cancelDisconnectGrace()
        if !state.peerId.isEmpty { socket.emitCallEnd(to: state.peerId, callId: state.callId) }
        state.networkEnded = true
        cleanup(.ended)
    }

    /// 全部撤销(恢复连接/收尾时);注意:仅恢复时清计数,防抖/窗口期间不清,保证重试上限生效
    private func cancelIceRestart() {
        iceRestartDebounceTask?.cancel(); iceRestartDebounceTask = nil
        iceRestartRecoverTask?.cancel(); iceRestartRecoverTask = nil
        iceRestartCount = 0
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
