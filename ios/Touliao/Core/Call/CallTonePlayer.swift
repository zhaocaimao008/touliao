import Foundation
import AVFoundation

/// 通话提示音：回铃音（主叫呼出→接通前循环）+ 接通提示音。
/// 与 Android CallManager 的 ToneGenerator(回铃/接通) 对齐。
/// 音频用内存合成的 16-bit PCM WAV（无需打包资源），走当前通话音频会话路由。
final class CallTonePlayer {
    private var ringbackPlayer: AVAudioPlayer?
    private var connectedPlayer: AVAudioPlayer?
    private let sampleRate = 16000.0

    /// 配置音频会话为 playAndRecord(通话模式):忽略静音键——回铃音无声根因之一
    /// (AVAudioPlayer 默认会话尊重静音键)。与 CallManager.configureAudioSession
    /// 参数一致,重复调用幂等。
    private func ensureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.duckOthers])
            try session.setActive(true)
        } catch {
            print("[CallTone] 音频会话配置失败(回铃音可能无声): \(error.localizedDescription)")
        }
    }

    /// 主叫呼出→接通前：循环回铃音（1s 双音「嘟」+ 2s 静默，无限循环）。
    func playRingback() {
        stop()
        ensureAudioSession()
        let tone = pcmTone(freqs: [440, 480], seconds: 1.0, amplitude: 0.25)
        let silence = pcmSilence(seconds: 2.0)
        let wav = wavData(pcm: tone + silence)
        do {
            ringbackPlayer = try AVAudioPlayer(data: wav)
        } catch {
            print("[CallTone] AVAudioPlayer 创建失败(回铃音无声): \(error.localizedDescription)")
            return
        }
        ringbackPlayer?.numberOfLoops = -1
        ringbackPlayer?.volume = 1.0
        ringbackPlayer?.play()
    }

    /// 首次接通：停回铃 + 播一声短促接通提示音。
    func playConnected() {
        ringbackPlayer?.stop()
        ringbackPlayer = nil
        let beep = pcmTone(freqs: [1000], seconds: 0.18, amplitude: 0.3)
        let wav = wavData(pcm: beep)
        do {
            connectedPlayer = try AVAudioPlayer(data: wav)
        } catch {
            print("[CallTone] 接通提示音创建失败: \(error.localizedDescription)")
            return
        }
        connectedPlayer?.volume = 1.0
        connectedPlayer?.play()
    }

    /// 停止并释放（通话结束/清理时调用；幂等）。
    func stop() {
        ringbackPlayer?.stop(); ringbackPlayer = nil
        connectedPlayer?.stop(); connectedPlayer = nil
    }

    // MARK: - PCM 合成

    private func pcmTone(freqs: [Double], seconds: Double, amplitude: Double) -> [Int16] {
        let n = Int(sampleRate * seconds)
        var out = [Int16](repeating: 0, count: n)
        let scale = amplitude / Double(max(freqs.count, 1))
        for i in 0..<n {
            var s = 0.0
            for f in freqs { s += sin(2.0 * Double.pi * f * Double(i) / sampleRate) }
            // 首尾 5ms 淡入淡出，消除爆音
            let fade = min(1.0, min(Double(i), Double(n - 1 - i)) / (sampleRate * 0.005))
            out[i] = Int16(max(-1.0, min(1.0, s * scale * fade)) * 32767.0)
        }
        return out
    }

    private func pcmSilence(seconds: Double) -> [Int16] {
        [Int16](repeating: 0, count: Int(sampleRate * seconds))
    }

    private func wavData(pcm: [Int16]) -> Data {
        let byteRate = Int(sampleRate) * 2
        let dataSize = pcm.count * 2
        var d = Data(capacity: 44 + dataSize)
        func u32(_ v: Int) -> [UInt8] { let x = UInt32(v); return [UInt8(x & 0xff), UInt8((x >> 8) & 0xff), UInt8((x >> 16) & 0xff), UInt8((x >> 24) & 0xff)] }
        func u16(_ v: Int) -> [UInt8] { let x = UInt16(v); return [UInt8(x & 0xff), UInt8((x >> 8) & 0xff)] }
        d.append(contentsOf: Array("RIFF".utf8))
        d.append(contentsOf: u32(36 + dataSize))
        d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8))
        d.append(contentsOf: u32(16))            // PCM fmt chunk size
        d.append(contentsOf: u16(1))             // audioFormat = PCM
        d.append(contentsOf: u16(1))             // channels = mono
        d.append(contentsOf: u32(Int(sampleRate)))
        d.append(contentsOf: u32(byteRate))
        d.append(contentsOf: u16(2))             // block align
        d.append(contentsOf: u16(16))            // bits per sample
        d.append(contentsOf: Array("data".utf8))
        d.append(contentsOf: u32(dataSize))
        for s in pcm { d.append(contentsOf: u16(Int(UInt16(bitPattern: s)))) }
        return d
    }
}
