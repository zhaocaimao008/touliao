import SwiftUI
import AVFoundation
import WebRTC

/// 全局通话浮层：通话激活时覆盖在主界面之上。
struct CallHostView: View {
    @ObservedObject private var manager = CallManager.shared

    var body: some View {
        if manager.state.stage != .idle {
            CallView(manager: manager)
                .transition(.opacity)
        }
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
                                .clipShape(RoundedRectangle(cornerRadius: 8))
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
                    Text(statusText)
                        .font(.subheadline).foregroundColor(Color(white: 0.7))
                    Spacer()
                }
            }

            VStack {
                Spacer()
                controls.padding(.bottom, 48)
            }
        }
        .task { await ensurePermissions() }
        .onChange(of: state.stage) { stage in
            if stage == .ended {
                Task { try? await Task.sleep(nanoseconds: 800_000_000); manager.consumeEnded() }
            }
        }
    }

    private var statusText: String {
        switch state.stage {
        case .outgoing: return "正在呼叫…"
        case .incoming: return state.isVideo ? "邀请你视频通话" : "邀请你语音通话"
        case .connecting: return "连接中…"
        case .connected: return "通话中"
        case .ended: return "通话结束"
        case .idle: return ""
        }
    }

    @ViewBuilder private var controls: some View {
        if state.stage == .incoming {
            HStack(spacing: 56) {
                circleButton("接听", .green) { manager.accept() }
                circleButton("拒绝", .red) { manager.reject() }
            }
        } else {
            HStack(spacing: 28) {
                circleButton(state.micEnabled ? "静音" : "取消静音", Color(white: 0.35)) { manager.toggleMic() }
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
