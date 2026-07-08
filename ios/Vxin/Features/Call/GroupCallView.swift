import SwiftUI
import AVFoundation
import WebRTC

/// 全局群通话浮层 + 来电邀请横幅：常驻挂载于 RootView。
struct GroupCallHostView: View {
    @ObservedObject private var manager = GroupCallManager.shared

    var body: some View {
        ZStack {
            if manager.state.stage != .idle {
                GroupCallView(manager: manager).transition(.opacity)
            } else if let inv = manager.pendingInvite {
                VStack {
                    inviteBanner(inv)
                    Spacer()
                }
                .padding(.top, 60)
            }
        }
    }

    private func inviteBanner(_ inv: GroupCallInvite) -> some View {
        HStack(spacing: 12) {
            Text("\(inv.fromName.isEmpty ? "群成员" : inv.fromName) 发起了群\(inv.type == "video" ? "视频" : "语音")通话")
                .font(.subheadline).foregroundColor(.white)
            Button("加入") { manager.join(callId: inv.callId, conversationId: inv.conversationId, video: inv.type == "video") }
                .padding(.horizontal, 14).padding(.vertical, 6)
                .background(Color.green).foregroundColor(.white).clipShape(Capsule())
            Button("忽略") { manager.pendingInvite = nil }
                .foregroundColor(Color(white: 0.7))
        }
        .padding(12)
        .background(Color(white: 0.18)).clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

private struct GroupCallView: View {
    @ObservedObject var manager: GroupCallManager
    private var state: GroupCallState { manager.state }

    private var columns: [GridItem] {
        let n = state.participants.count + 1
        let count = n <= 1 ? 1 : (n <= 4 ? 2 : 3)
        return Array(repeating: GridItem(.flexible(), spacing: 6), count: count)
    }

    var body: some View {
        ZStack {
            Color(white: 0.07).ignoresSafeArea()

            VStack {
                VStack(spacing: 2) {
                    Text("群\(state.isVideo ? "视频" : "语音")通话 · \(state.participants.count + 1) 人")
                        .font(.subheadline).foregroundColor(.white)
                    // 接通后每秒递增的通话时长(mm:ss)，对齐微信/安卓
                    if state.stage == .connected, let start = state.connectedAt {
                        TimelineView(.periodic(from: start, by: 1)) { context in
                            Text(formatCallDuration(from: start, now: context.date))
                                .font(.caption2).foregroundColor(Color(white: 0.7)).monospacedDigit()
                        }
                    }
                }.padding(.top, 12)

                ScrollView {
                    LazyVGrid(columns: columns, spacing: 6) {
                        tile(track: state.isVideo && state.cameraEnabled ? manager.localVideoTrack : nil, label: "我", mirror: true)
                        ForEach(state.participants, id: \.self) { pid in
                            tile(track: state.isVideo ? manager.remoteTracks[pid] : nil, label: "成员", mirror: false)
                        }
                    }
                    .padding(8)
                }

                controls.padding(.bottom, 40)
            }
        }
        .task { await ensurePermissions() }
        .onChange(of: state.stage) { stage in
            if stage == .ended {
                Task { try? await Task.sleep(nanoseconds: 800_000_000); manager.consumeEnded() }
            }
        }
    }

    private func tile(track: RTCVideoTrack?, label: String, mirror: Bool) -> some View {
        ZStack(alignment: .bottomLeading) {
            Color.black
            if let track {
                GroupRTCVideoView(track: track, mirror: mirror)
            } else {
                InitialAvatar(name: label, size: 64)
            }
            Text(label).font(.caption2).foregroundColor(.white).padding(6)
        }
        .aspectRatio(0.85, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder private var controls: some View {
        HStack(spacing: 28) {
            circleButton(state.micEnabled ? "静音" : "取消静音", Color(white: 0.35)) { manager.toggleMic() }
            circleButton("挂断", .red) { manager.hangup() }
            if state.isVideo {
                circleButton(state.cameraEnabled ? "关摄像头" : "开摄像头", Color(white: 0.35)) { manager.toggleCamera() }
                circleButton("翻转", Color(white: 0.35)) { manager.switchCamera() }
            }
        }
    }

    private func circleButton(_ label: String, _ color: Color, _ action: @escaping () -> Void) -> some View {
        VStack(spacing: 4) {
            Button(action: action) {
                Text(String(label.prefix(2)))
                    .font(.caption).foregroundColor(.white)
                    .frame(width: 60, height: 60).background(color).clipShape(Circle())
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

private struct GroupRTCVideoView: UIViewRepresentable {
    let track: RTCVideoTrack
    let mirror: Bool

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
