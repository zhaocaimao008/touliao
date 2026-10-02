import Foundation
import AVFoundation
import UIKit
import WebRTC

/// 1v1(CallManager) 与群通话(GroupCallManager) 共用的音频会话恢复 / 扬声器路由 / 设备状态工具。
/// 2026-10-02 通话缺陷批次 1：
/// - 打断恢复只恢复 category/mode/options 与扬声器 override，不再 setActive(true)——
///   RTCAudioSession 的激活是计数式的，反复 setActive(true) 只增不减会导致会话永远停不掉，
///   且 WebRTC 自身已处理打断（恢复音频单元），重复激活只会与其打架。
/// - 所有调用方都在主线程（通知 queue: .main / Combine receive(on: main)）。
enum CallAudioSupport {
    /// 上次因路由变化强制扬声器的时刻：限流防止与系统/WebRTC 路由决策来回拉锯（主线程访问）
    private static var lastForcedSpeakerAt: Date?

    /// 恢复通话会话参数（.playAndRecord + .voiceChat + .allowBluetooth）与扬声器路由；不调用 setActive。
    static func restoreCallConfiguration(speakerOn: Bool, tag: String) {
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do {
            try session.setCategory(AVAudioSession.Category.playAndRecord, with: [.allowBluetooth])
            try session.setMode(AVAudioSession.Mode.voiceChat)
        } catch {
            print("\(tag) 恢复通话音频会话参数失败: \(error.localizedDescription)")
        }
        // 用户选了扬声器但当前接着蓝牙/耳机等外设：不强行抢到扬声器
        if !speakerOn || !hasExternalOutput() {
            do { try session.overrideOutputAudioPort(speakerOn ? .speaker : .none) } catch {
                print("\(tag) 恢复扬声器路由失败: \(error.localizedDescription)")
            }
        }
        session.unlockForConfiguration()
    }

    /// 当前输出是否为蓝牙/有线耳机/车载/AirPlay 等外设（非机身听筒/扬声器）。
    static func hasExternalOutput() -> Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains {
            $0.portType != .builtInReceiver && $0.portType != .builtInSpeaker
        }
    }

    /// 路由变化后是否需要把扬声器 override 补回来：
    /// 仅处理类别变化(WebRTC 启动音频单元时会重设类别、冲掉 override)/override/路由配置变化/外设拔出；
    /// 已在扬声器上（含我们自己 override 触发的这次通知）或接着外设时不处理，避免递归与抢路由。
    static func shouldReapplySpeaker(_ note: Notification) -> Bool {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return false }
        switch reason {
        case .categoryChange, .override, .routeConfigurationChange, .oldDeviceUnavailable:
            break
        default:
            return false
        }
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        if outputs.contains(where: { $0.portType == .builtInSpeaker }) { return false }
        if hasExternalOutput() { return false }
        // 限流：1s 内已强制过一次仍被冲掉，说明有别的组件在持续改路由，不再拉锯
        if let last = lastForcedSpeakerAt, Date().timeIntervalSince(last) < 1 { return false }
        return true
    }

    /// 经 RTCAudioSession 锁强制输出到扬声器（与 toggleSpeaker 同一路径）。
    static func forceSpeaker(tag: String) {
        lastForcedSpeakerAt = Date()
        let session = RTCAudioSession.sharedInstance()
        session.lockForConfiguration()
        do { try session.overrideOutputAudioPort(.speaker) } catch {
            print("\(tag) 路由变化后恢复扬声器失败: \(error.localizedDescription)")
        }
        session.unlockForConfiguration()
    }

    /// 通话中：语音通话开距离传感器（贴耳熄屏防误触），视频通话不开；通话中禁止自动锁屏。
    /// 1v1 与群互斥，按两边当前状态统一计算，结束时自动复原。须在主线程调用。
    static func refreshDeviceGuards() {
        let one = CallManager.shared.state
        let group = GroupCallManager.shared.state
        let oneActive = one.stage == .outgoing || one.stage == .connecting || one.stage == .connected
        let groupActive = group.stage == .connecting || group.stage == .connected
        let active = oneActive || groupActive
        let isVideo = oneActive ? one.isVideo : group.isVideo
        let proximity = active && !isVideo
        if UIDevice.current.isProximityMonitoringEnabled != proximity {
            UIDevice.current.isProximityMonitoringEnabled = proximity
        }
        if UIApplication.shared.isIdleTimerDisabled != active {
            UIApplication.shared.isIdleTimerDisabled = active
        }
    }
}

/// 通话用后台任务（被打断/协商阶段在后台争取执行时间）。begin/end 幂等，须在主线程调用。
/// 过期 handler 里必须立即 end，否则系统会直接强杀 App。
final class CallBackgroundTask {
    private let name: String
    private var taskId: UIBackgroundTaskIdentifier = .invalid

    init(name: String) { self.name = name }

    func begin() {
        guard taskId == .invalid else { return }
        taskId = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            self?.end()
        }
    }

    func end() {
        guard taskId != .invalid else { return }
        let id = taskId
        taskId = .invalid
        UIApplication.shared.endBackgroundTask(id)
    }
}
