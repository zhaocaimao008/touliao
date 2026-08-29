import Foundation
import AVFoundation

/// 语音录制：输出 MPEG-4/AAC（.m4a，audio/mp4），匹配后端允许的音频类型。
/// 与 Android AudioRecorder 对齐。
final class AudioRecorder {
    static let shared = AudioRecorder()
    private init() {}

    private var recorder: AVAudioRecorder?
    private(set) var currentURL: URL?
    /// 2026-08-29新增：与 Android lastDurationSeconds 对齐，供上传时携带 duration 字段。
    private(set) var lastDurationSeconds: Int = 0
    /// 录音开始的墙钟时间；stop() 时用它算耗时，不依赖 AVAudioRecorder.currentTime——
    /// 真机反馈时长一直是0，怀疑是 currentTime 在读取时机上不如预期可靠，改用系统时钟
    /// 更直接、跟 Android 用 SystemClock.elapsedRealtime() 算耗时的做法完全对齐。
    private var startedAt: Date?

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
            startedAt = Date()
            return true
        } catch {
            return false
        }
    }

    /// 停止并返回录音文件 URL
    func stop() -> URL? {
        if let startedAt {
            lastDurationSeconds = max(0, Int(Date().timeIntervalSince(startedAt)))
        }
        recorder?.stop()
        recorder = nil
        startedAt = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        return currentURL
    }

    func cancel() {
        recorder?.stop()
        recorder = nil
        startedAt = nil
        if let url = currentURL { try? FileManager.default.removeItem(at: url) }
        currentURL = nil
    }
}
