import Foundation
import AVFoundation

/// 极简语音播放（点按播放）。与 Android AudioPlayer 对齐。
final class AudioPlayerService {
    static let shared = AudioPlayerService()
    private init() {}

    private var loadTask: Task<Void, Never>?
    private var player: AVPlayer?
    private var endObserver: NSObjectProtocol?

    func play(urlString: String) {

        // 通话进行中不改音频会话类别，避免把 .voiceChat 抢成 .playback 导致通话音频路由错乱。
        if Self.isCallAudioActive { return }
        stop()
        loadTask = Task { @MainActor in
        do {
        let url = try await MediaUrlResolver.ticket(urlString)
        try Task.checkCancellation()
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        let item = AVPlayerItem(url: url)
        // 播完自动收尾：停止并归还音频会话（原实现播完不复位，长期占用 .playback）
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in self?.stop() }
        player = AVPlayer(playerItem: item)
        player?.play()
        } catch is CancellationError { }
        catch { stop() }
        }
    }

    func stop() {
        loadTask?.cancel()
        loadTask = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        player?.pause()
        player = nil
        // 归还音频会话，便于系统/通话恢复常规路由（notifyOthersOnDeactivation 让其他音频继续）。
        // 通话中不得停用：会话是全 App 共用的，退出聊天页(onLeave)调 stop() 会把通话音频一起关掉。
        if !Self.isCallAudioActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    /// 1 对 1 或群通话进行中（通话持有共享音频会话）。
    static var isCallAudioActive: Bool {
        let one = CallManager.shared.state.stage
        let group = GroupCallManager.shared.state.stage
        return (one != .idle && one != .ended) || (group != .idle && group != .ended)
    }
}
