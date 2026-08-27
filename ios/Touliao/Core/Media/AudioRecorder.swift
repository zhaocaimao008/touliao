import Foundation
import AVFoundation

/// 语音录制：输出 MPEG-4/AAC（.m4a，audio/mp4），匹配后端允许的音频类型。
/// 与 Android AudioRecorder 对齐。
final class AudioRecorder {
    static let shared = AudioRecorder()
    private init() {}

    private var recorder: AVAudioRecorder?
    private(set) var currentURL: URL?

    let mimeType = "audio/mp4"

    /// 请求麦克风权限
    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func start() -> Bool {
        cancel()
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default)
            try session.setActive(true)
        } catch {
            return false
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice_\(Int(Date().timeIntervalSince1970)).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            AVEncoderBitRateKey: 64_000,
        ]
        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            guard r.record() else { return false }
            recorder = r
            currentURL = url
            return true
        } catch {
            return false
        }
    }

    /// 停止并返回录音文件 URL
    func stop() -> URL? {
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        return currentURL
    }

    func cancel() {
        recorder?.stop()
        recorder = nil
        if let url = currentURL { try? FileManager.default.removeItem(at: url) }
        currentURL = nil
    }
}
