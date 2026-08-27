import Foundation
import CallKit
import Combine
import UIKit
import AVFoundation

/// CallKit：来电系统界面的管理与收尾（接听/拒接/挂断/静音动作分发、120s 响铃超时、通话结束收尾）。
///
/// ⚠️ PushKit VoIP push 链路已整体移除（2026-08）：Apple 已从 App ID 移除 VoIP Services capability，
/// 且 App Store Guideline 2.5.4 对无真实 VoIP 功能却使用 VoIP push 的 App 审核从严。
/// 本类不再注册 PKPushRegistry / desiredPushTypes=[.voIP]、不再实现 didReceiveIncomingPushWith，
/// 「App 被彻底杀死后被系统唤醒弹系统来电」已不再支持，来电统一走 APNs/FCM 通知 + socket
/// （CallManager.incomingFromPush）路径；后端 sendVoipPush(platform=ios_voip) 为死链路（后端另行清理）。
///
/// 保留 CallKit 部分：CallManager 在 accept/reject/hangup/socket call:end 时调用 endActiveCall()
/// 同步收尾系统来电界面；若后续需要重新上报 CallKit（如恢复系统来电 UI），reportIncomingCall 仍可用。
final class VoipCallManager: NSObject, CXProviderDelegate {
    static let shared = VoipCallManager()
    private override init() {}

    private var provider: CXProvider?

    private var pendingCallUUID: UUID?
    private var pendingCallInfo: (callId: String, from: String, callerName: String, callType: String)?

    /// App 启动后调用一次：创建 CXProvider（CallKit 系统界面所需；PKPushRegistry 注册已随 VoIP push 移除）。
    func activate() {
        let config = CXProviderConfiguration(localizedName: "投聊")
        config.iconTemplateImageData = nil
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        let provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: nil)
        self.provider = provider
    }

    // MARK: - 来电上报（CallKit）

    private func reportIncomingCall(callId: String, from: String, callerName: String, callType: String) {
        let uuid = UUID()
        pendingCallUUID = uuid
        pendingCallInfo = (callId: callId, from: from, callerName: callerName, callType: callType)
        // 先置本地通话状态，防止随后到达的 socket call:incoming 与 CallKit 竞态
        CallManager.shared.incomingFromPush(from: from, callType: callType, callerName: callerName, callId: callId)

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: from)
        update.localizedCallerName = callerName.isEmpty ? "来电" : callerName
        update.hasVideo = callType == "video"
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        provider?.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error {
                print("[Voip] reportNewIncomingCall 失败: \(error.localizedDescription)")
            }
        }

        // 被叫侧本地 120s 响铃超时（对齐服务端 CALL_TIMEOUT_MS）→ 未接听自动结束 CallKit + reject 信令。
        // 接听后 pendingCallInfo 会被置 nil，此处据此跳过，避免已接通通话被定时器误挂。
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
            guard let self, self.pendingCallUUID == uuid, self.pendingCallInfo != nil else { return }
            self.endCallIfNeeded(uuid: uuid)
            CallManager.shared.reject()
        }
    }

    // MARK: - CXProviderDelegate

    func providerDidReset(_ provider: CXProvider) {}

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        CallManager.shared.accept()
        // 保留 pendingCallUUID 供 endActiveCall() 在通话结束时关闭系统通话 UI；
        // 清空 pendingCallInfo，使后续 CXEndCallAction 走 hangup() 而非 reject()（已不是 incoming 态）。
        pendingCallInfo = nil
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if pendingCallInfo != nil {
            CallManager.shared.reject()
        } else {
            CallManager.shared.hangup()
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        // 不支持保持，直接放行
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        CallManager.shared.toggleMic()
        action.fulfill()
    }

    // MARK: - 收尾

    func endCallIfNeeded(uuid: UUID) {
        provider?.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
        if pendingCallUUID == uuid {
            pendingCallUUID = nil
            pendingCallInfo = nil
        }
    }

    /// 供 CallManager 在 accept/reject/hangup/socket call:end 时同步收尾 CallKit 界面。
    func endActiveCall() {
        guard let uuid = pendingCallUUID else { return }
        endCallIfNeeded(uuid: uuid)
    }
}
