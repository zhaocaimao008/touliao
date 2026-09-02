import SwiftUI
import AVFoundation
import WebRTC

/// 全局通话浮层：通话激活时覆盖在主界面之上。
/// 2026-08-29新增通话小窗：isMinimized时改渲染悬浮小窗，用户可退回App其它页面操作，
/// 媒体流(PeerConnection)不受UI切换影响——小窗和全屏通话界面共用同一个 CallManager.shared。
struct CallHostView: View {
    @ObservedObject private var manager = CallManager.shared

    var body: some View {
        if manager.state.stage != .idle {
            if manager.state.isMinimized {
                CallMinimizedBubble(manager: manager)
                    .transition(.scale.combined(with: .opacity))
            } else {
                CallView(manager: manager)
                    .transition(.opacity)
            }
        }
    }
}

/// 通话小窗：可拖拽悬浮气泡，默认停靠右上角；拖动跟手，松手停在拖到的位置(不做边缘吸附，
/// 保持简单)。视频通话且已接通时显示对方视频画面缩略图，其余情况显示头像。点击恢复全屏。
private struct CallMinimizedBubble: View {
    @ObservedObject var manager: CallManager
    private var state: CallState { manager.state }

    @State private var dragAccumulated: CGSize = .zero
    @GestureState private var dragActive: CGSize = .zero

    private let bubbleSize: CGFloat = 64

    var body: some View {
        GeometryReader { geo in
            let margin: CGFloat = bubbleSize / 2 + 8
            let defaultX = geo.size.width - margin
            let defaultY: CGFloat = 130
            let x = clamp(defaultX + dragAccumulated.width + dragActive.width, geo.size.width, margin)
            let y = clamp(defaultY + dragAccumulated.height + dragActive.height, geo.size.height, margin)

            bubbleContent
                .position(x: x, y: y)
                .gesture(
                    DragGesture()
                        .updating($dragActive) { value, s, _ in s = value.translation }
                        .onEnded { value in
                            dragAccumulated.width += value.translation.width
                            dragAccumulated.height += value.translation.height
                        }
                )
                .onTapGesture { manager.setMinimized(false) }
        }
        .allowsHitTesting(true)
    }

    @ViewBuilder private var bubbleContent: some View {
        ZStack {
            if state.isVideo && state.remoteVideoActive && state.stage == .connected {
                RTCVideoViewRepresentable(track: manager.remoteVideoTrack)
            } else {
                Color(white: 0.15)
                InitialAvatar(name: state.peerName.isEmpty ? "?" : state.peerName, size: bubbleSize)
            }
            if state.stage != .connected {
                Color.black.opacity(0.35)
                ProgressView().tint(.white).scaleEffect(0.7)
            }
        }
        .frame(width: bubbleSize, height: bubbleSize)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.25), lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 8, y: 3)
    }

    /// 限制气泡中心点不超出屏幕(留 margin 边距)，避免拖出可视区域后再也够不着。
    private func clamp(_ v: CGFloat, _ total: CGFloat, _ margin: CGFloat) -> CGFloat {
        min(max(v, margin), max(margin, total - margin))
    }
}

private struct CallView: View {
    @ObservedObject var manager: CallManager
    private var state: CallState { manager.state }

    var body: some View {
        ZStack {
            Color(white: 0.1).ignoresSafeArea()

            if state.isVideo && state.remoteVideoActive && state.stage == .connected {
                RTCVideoViewRepresentable(track: manager.remoteVideoTrack)
                    .ignoresSafeArea()
                if state.cameraEnabled {
                    VStack {
                        HStack {
                            Spacer()
                            RTCVideoViewRepresentable(track: manager.localVideoTrack)
                                .frame(width: 110, height: 160)
                                .clipShape(RoundedRectangle(cornerRadius: VxinRadius.thumb))
                                .padding()
                        }
                        Spacer()
                    }
                }
            } else {
                VStack(spacing: 16) {
                    Spacer().frame(height: 80)
                    InitialAvatar(name: state.peerName.isEmpty ? "?" : state.peerName, size: 96)
                    Text(state.peerName.isEmpty ? "通话" : state.peerName)
                        .font(.title2).foregroundColor(.white)
                    statusOrDuration
                    Spacer()
                }
            }

            VStack {
                Spacer()
                controls.padding(.bottom, 48)
            }

            // 2026-08-29新增：通话小窗入口。仅在"已经在通话流程中"(呼出/连接中/已接通)显示，
            // 来电振铃/结束态不显示——铃响时应先决定接听或拒绝，不给"划走忽略"的误解空间。
            if state.stage == .outgoing || state.stage == .connecting || state.stage == .connected {
                VStack {
                    HStack {
                        Button { manager.setMinimized(true) } label: {
                            Image(systemName: "chevron.down")
                                .font(.headline).foregroundColor(.white)
                                .frame(width: 36, height: 36)
                                .background(Color.white.opacity(0.15)).clipShape(Circle())
                        }
                        .padding(.leading, 16)
                        Spacer()
                    }
                    Spacer()
                }
                .padding(.top, 8)
            }
        }
        .task { await ensurePermissions() }
        // 结束态的自动consumeEnded延时已挪到 CallManager.cleanup() 里统一调度(不依赖某个具体
        // UI是否挂载——通话小窗状态下CallView根本不在视图树里，onChange不会触发)。
    }

    /// 已接通显示每秒递增的通话时长(mm:ss)；结束态定格总时长；否则状态文案(对齐微信/安卓)
    @ViewBuilder private var statusOrDuration: some View {
        if state.stage == .connected, let start = state.connectedAt {
            TimelineView(.periodic(from: start, by: 1)) { context in
                Text(formatCallDuration(from: start, now: context.date))
                    .font(.subheadline).foregroundColor(Color(white: 0.7))
                    .monospacedDigit()
            }
        } else if state.stage == .ended, let start = state.connectedAt {
            // 接通过再结束：定格显示「通话时长 mm:ss」
            Text("通话时长 " + formatCallDuration(from: start, now: state.endedAt ?? Date()))
                .font(.subheadline).foregroundColor(Color(white: 0.7)).monospacedDigit()
        } else {
            Text(statusText)
                .font(.subheadline).foregroundColor(Color(white: 0.7))
        }
        // 通话质量指示：getStats 2s 采样（RTT<200ms/丢包<2% 优; <500ms/<8% 中; 否则差）
        if state.stage == .connected && !state.callQuality.isEmpty {
            let (qColor, qText): (Color, String) = switch state.callQuality {
            case "poor": (Color(red: 0.98, green: 0.32, blue: 0.32), "网络较差")
            case "medium": (Color(red: 0.96, green: 0.65, blue: 0.14), "网络一般")
            default: (.vxinSuccess, "网络良好")
            }
            Text(qText)
                .font(.caption).foregroundColor(qColor)
        }
    }

    private var statusText: String {
        switch state.stage {
        case .outgoing: return "正在呼叫…"
        case .incoming: return state.isVideo ? "邀请你视频通话" : "邀请你语音通话"
        case .connecting: return "连接中…"
        case .connected: return "通话中"
        case .ended: return state.timedOut ? "对方未接听" : (state.networkEnded ? "网络已断开" : "通话结束")
        case .idle: return ""
        }
    }

    @ViewBuilder private var controls: some View {
        if state.stage == .incoming {
            HStack(spacing: 24) {
                circleButton("接听", .vxinSuccess) { manager.accept() }
                circleButton("回复", Color(white: 0.35)) { manager.rejectAndReply() }
                circleButton("拒绝", .red) { manager.reject() }
            }
        } else {
            HStack(spacing: 28) {
                circleButton(state.micEnabled ? "静音" : "取消静音", Color(white: 0.35)) { manager.toggleMic() }
                circleButton(state.speakerOn ? "听筒" : "扬声器", Color(white: 0.35)) { manager.toggleSpeaker() }
                circleButton(state.isVideo ? "切语音" : "切视频", Color(white: 0.35)) { manager.toggleVideo() }
                circleButton("挂断", .red) { manager.hangup() }
                if state.isVideo {
                    circleButton(state.cameraEnabled ? "关摄像头" : "开摄像头", Color(white: 0.35)) { manager.toggleCamera() }
                    circleButton("翻转", Color(white: 0.35)) { manager.switchCamera() }
                }
            }
        }
    }

    private func circleButton(_ label: String, _ color: Color, _ action: @escaping () -> Void) -> some View {
        VStack(spacing: 4) {
            Button(action: action) {
                Text(String(label.prefix(2)))
                    .font(.caption).foregroundColor(.white)
                    .frame(width: 60, height: 60)
                    .background(color).clipShape(Circle())
            }
            Text(label).font(.caption2).foregroundColor(Color(white: 0.8))
        }
    }

    private func ensurePermissions() async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            AVCaptureDevice.requestAccess(for: .audio) { _ in cont.resume() }
        }
        if state.isVideo {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                AVCaptureDevice.requestAccess(for: .video) { _ in cont.resume() }
            }
        }
    }
}

/// RTCMTLVideoView 包装：按 track 挂载渲染。
private struct RTCVideoViewRepresentable: UIViewRepresentable {
    let track: RTCVideoTrack?

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView()
        view.videoContentMode = .scaleAspectFill
        return view
    }

    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {
        context.coordinator.attach(track, to: uiView)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        private weak var current: RTCVideoTrack?
        func attach(_ track: RTCVideoTrack?, to view: RTCMTLVideoView) {
            guard current !== track else { return }
            current?.remove(view)
            current = track
            track?.add(view)
        }
    }
}
