import SwiftUI
import PhotosUI

/// 2026-10-12（8.1.41）：选中视频后的"读取 → 转成兼容格式"流程，带可见进度与取消。
/// 之前转码藏在 loadTransferable 里，4K/HEVC 视频要等几十秒界面毫无反应。
/// 聊天(ChatView)与朋友圈发布(MomentComposeView)共用；每个页面持有一个实例(@StateObject)。
@MainActor
final class VideoPreparation: ObservableObject {
    enum Phase: Equatable {
        case idle
        /// 从相册/iCloud 读取原片（无确定进度）
        case importing
        /// 导出 H.264 mp4，0...1
        case converting(Double)
    }

    @Published private(set) var phase: Phase = .idle
    private var task: Task<Void, Never>?
    private var generation = 0

    var isActive: Bool { phase != .idle }

    /// 开始处理；同一时间只处理一个，再次调用会取消上一个。
    /// onReady 拿到的文件已在 staging 目录，所有权交给调用方（上传后/放弃时由调用方清理）。
    func start(_ item: PhotosPickerItem,
               onReady: @escaping @MainActor (PickedVideoFile) -> Void,
               onError: @escaping @MainActor (String) -> Void) {
        cancel()
        generation += 1
        let current = generation
        phase = .importing
        task = Task {
            let picked: PickedVideoFile
            do {
                guard let file = try await item.loadTransferable(type: PickedVideoFile.self) else {
                    guard self.finish(current) else { return }
                    onError("无法读取所选视频，请重试或更换一个视频")
                    return
                }
                picked = file
            } catch {
                guard self.finish(current), !Task.isCancelled else { return }
                onError("视频导入失败：\(error.localizedDescription)")
                return
            }
            guard !Task.isCancelled, self.generation == current else {
                PickedVideoCleanup.removeFile(picked.url)
                return
            }
            self.phase = .converting(0)
            let prepared = await PickedVideoTranscoder.prepareForUpload(picked) { [self] value in
                guard self.generation == current, self.isActive else { return }
                self.phase = .converting(min(1, max(0, value)))
            }
            guard let prepared else { return }   // 已取消，文件已清理
            guard self.finish(current), !Task.isCancelled else {
                PickedVideoCleanup.removeFile(prepared.url)
                return
            }
            onReady(prepared)
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
        generation += 1
        phase = .idle
    }

    /// 本轮仍是当前一轮时复位为 idle 并返回 true；已被取消/取代返回 false。
    private func finish(_ current: Int) -> Bool {
        guard generation == current else { return false }
        task = nil
        phase = .idle
        return true
    }
}

/// 处理中的浮层："正在读取视频…" / "正在处理视频… 42%" + 取消。
struct VideoPreparationHUD: View {
    @ObservedObject var preparation: VideoPreparation

    var body: some View {
        if preparation.isActive {
            VStack(spacing: 10) {
                switch preparation.phase {
                case .converting(let value):
                    Text("正在处理视频… \(Int((value * 100).rounded()))%")
                        .touliaoText(.secondary)
                        .foregroundColor(.white)
                    ProgressView(value: value)
                        .progressViewStyle(.linear)
                        .tint(.white)
                        .frame(width: 180)
                default:
                    ProgressView().progressViewStyle(.circular).tint(.white)
                    Text("正在读取视频…").touliaoText(.secondary).foregroundColor(.white)
                }
                Text("转换为通用格式，对方各端都能播放")
                    .touliaoText(.caption)
                    .foregroundColor(.white.opacity(0.75))
                Button("取消") { preparation.cancel() }
                    .foregroundColor(.white)
                    .padding(.top, 2)
                    .accessibilityIdentifier("video-prep-cancel")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.black.opacity(0.78)))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("video-prep-hud")
            .transition(.opacity)
        }
    }
}
