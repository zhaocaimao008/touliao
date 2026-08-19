import Foundation
import PushKit
import CallKit
import Combine
import UIKit
import AVFoundation

/// PushKit(VoIP push) + CallKit：App 被彻底杀死时也能被系统唤醒并弹出系统来电界面。
/// 与后端 sendVoipPush(platform=ios_voip) 配对；前台/后台静默推送(content-available)
/// 仍走 AppDelegate.didReceiveRemoteNotification，二者不冲突（前台优先走应用内 UI，见下）。
final class VoipCallManager: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
    static let shared = VoipCallManager()
    private override init() {}

    private var pushRegistry: PKPushRegistry?
    private let callController = CXCallController()
    private var provider: CXProvider?

    private var latestVoipToken: String?
    private var pendingCallUUID: UUID?
    private var pendingCallInfo: (callId: String, from: String, callerName: String, callType: String)?

    /// App 启动后调用一次：建 CXProvider + 注册 PushKit VoIP。
    func activate() {
        let config = CXProviderConfiguration(localizedName: "投聊")
        config.iconTemplateImageData = nil
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        let provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: nil)
        self.provider = provider

        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.pushRegistry = registry
    }

    // MARK: - PKPushRegistryDelegate

    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        latestVoipToken = token
        print("[Voip] token prefix=\(token.prefix(12))…")   // 安全：只打印前缀
        if KeychainStore.shared.isLoggedIn {
            Task { await NotificationRepository.shared.register(token: token, platform: "ios_voip") }
        }
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        if let token = latestVoipToken {
            Task { await NotificationRepository.shared.delete(token: token) }
        }
        latestVoipToken = nil
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                       for type: PKPushType, completion: @escaping () -> Void) {
        // iOS 13+ 必须调用 completion，否则系统会终止进程（多次不调会被永久停用 VoIP 推送）
        defer { completion() }
        guard type == .voIP else { return }
        let d = payload.dictionaryPayload
        guard d["type"] as? String == "call" else { return }
        let callId = d["callId"] as? String ?? ""
        let from = d["from"] as? String ?? ""
        let callerName = d["callerName"] as? String ?? ""
        let callType = d["callType"] as? String ?? "audio"

        // 前台不弹 CallKit：应用内 CallHostView 已有来电 UI，避免双 UI（与 Android appForeground 去重对齐）
        guard UIApplication.shared.applicationState != .active else {
            CallManager.shared.incomingFromPush(from: from, callType: callType, callerName: callerName)
            return
        }
        // 同 callId 幂等忽略（对齐 incomingFromPush 的 peerId 去重）
        if let p = pendingCallInfo, p.callId == callId { return }
        reportIncomingCall(callId: callId, from: from, callerName: callerName, callType: callType)
    }

    private func reportIncomingCall(callId: String, from: String, callerName: String, callType: String) {
        let uuid = UUID()
        pendingCallUUID = uuid
        pendingCallInfo = (callId: callId, from: from, callerName: callerName, callType: callType)
        // 先置本地通话状态，防止随后到达的 socket call:incoming 与 CallKit 竞态
        CallManager.shared.incomingFromPush(from: from, callType: callType, callerName: callerName)

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

        // 被叫侧本地 120s 响铃超时（对齐服务端 CALL_TIMEOUT_MS）→ 未接听自动结束 CallKit + reject 信令
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
            guard let self, self.pendingCallUUID == uuid else { return }
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
        pendingCallUUID = nil
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
