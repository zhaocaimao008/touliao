import Foundation
import AVFoundation

/// 极简语音播放（点按播放）。与 Android AudioPlayer 对齐。
final class AudioPlayerService {
    static let shared = AudioPlayerService()
    private init() {}

    private var player: AVPlayer?
    private var endObserver: NSObjectProtocol?

    func play(urlString: String) {
        guard let url = URL(string: urlString) else { return }
        // 通话进行中不改音频会话类别，避免把 .voiceChat 抢成 .playback 导致通话音频路由错乱。
        if CallManager.shared.state.stage != .idle && CallManager.shared.state.stage != .ended { return }
        if GroupCallManager.shared.state.stage != .idle && GroupCallManager.shared.state.stage != .ended { return }
        stop()
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        let item = AVPlayerItem(url: url)
        // 播完自动收尾：停止并归还音频会话（原实现播完不复位，长期占用 .playback）
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in self?.stop() }
        player = AVPlayer(playerItem: item)
        player?.play()
    }

    func stop() {
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        player?.pause()
        player = nil
        // 归还音频会话，便于系统/通话恢复常规路由（notifyOthersOnDeactivation 让其他音频继续）
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
}
