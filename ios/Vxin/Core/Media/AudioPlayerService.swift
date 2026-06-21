import Foundation
import AVFoundation

/// 极简语音播放（点按播放）。与 Android AudioPlayer 对齐。
final class AudioPlayerService {
    static let shared = AudioPlayerService()
    private init() {}

    private var player: AVPlayer?

    func play(urlString: String) {
        guard let url = URL(string: urlString) else { return }
        stop()
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        player = AVPlayer(url: url)
        player?.play()
    }

    func stop() {
        player?.pause()
        player = nil
    }
}
