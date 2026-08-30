import UIKit
import Combine
import UserNotifications
import FirebaseCore
import FirebaseMessaging

/// 处理 Firebase 初始化、APNs 注册、FCM token、前台/点击通知。
/// SwiftUI 通过 @UIApplicationDelegateAdaptor 接入。
final class AppDelegate: NSObject, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // 有配置才初始化 Firebase（占位 plist 也可初始化，仅不会真正投递）
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
        }
        // CallKit：来电系统界面管理（PushKit VoIP 注册已移除，见 VoipCallManager.swift 注释）
        VoipCallManager.shared.activate()
        Messaging.messaging().delegate = self
        UNUserNotificationCenter.current().delegate = self

        // 来电通知分类：CallManager.showIncomingCallNotification 会设 categoryIdentifier=INCOMING_CALL，
        // 但此前全仓无 UNNotificationCategory 注册 → 通知上一直没有「接听/拒绝」按钮。
        // 按钮点击走 didReceive response 的 ANSWER/DECLINE 分支（见下）。
        let answer = UNNotificationAction(identifier: "ANSWER", title: "接听", options: [.foreground])
        let decline = UNNotificationAction(identifier: "DECLINE", title: "拒绝", options: [.destructive])
        let callCategory = UNNotificationCategory(
            identifier: "INCOMING_CALL", actions: [answer, decline],
            intentIdentifiers: [], options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([callCategory])

        return true
    }

    // APNs token → 交给 Firebase（FCM 底层走 APNs 投递）
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        // 同时上报 APNs 原始 token（64 位 hex）：后端直连 APNs 用它发送，
        // 不依赖 Firebase 控制台 APNs 密钥配置（无人值守环境下传不了密钥，
        // FCM→APNs 会因 third-party-auth-error 永远失败——锁屏无通知根因）。
        // 登录后才上报；未登录时缓存到 PushManager，登录后 registerApnsTokenIfNeeded 补报。
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        PushManager.shared.setApnsToken(hex)
        Task { await NotificationRepository.shared.diag("didRegister ok hexPrefix=\(String(hex.prefix(8))) isLoggedIn=\(KeychainStore.shared.isLoggedIn)") }
        if !hex.isEmpty && KeychainStore.shared.isLoggedIn {
            Task { await NotificationRepository.shared.register(token: hex, platform: "ios_apns") }
        }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // 占位/未配置或模拟器无 APNs 时会进这里——上报错误便于诊断锁屏无通知问题
        Task { await NotificationRepository.shared.diag("didFail error=\(error.localizedDescription)") }
        print("[APNs] 注册失败: \(error.localizedDescription)")
    }
}

// MARK: - FCM token
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        if let fcmToken { PushManager.shared.onToken(fcmToken) }
    }
}

// MARK: - 前台展示 / 点击
extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // 前台收到推送：App 已通过 socket 实时收到消息并更新 UI + 震动（ConversationListViewModel），
        // 再展示横幅会与应用内 UI 重复打扰。服务端现总是推送（修复锁屏无通知），
        // 故前台只响声音、不弹横幅；锁屏/后台由系统正常展示完整通知。
        completionHandler([.sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        // 来电通知动作：接听/拒绝。userInfo 由 CallManager.showIncomingCallNotification /
        // push.js pushCallInvite 携带 from/callType/callerName/callId；先 incomingFromPush 重建
        // incoming 状态（幂等，覆盖 App 被杀后由通知重新拉起、state 尚未建立的情况），再 accept/reject。
        let actionId = response.actionIdentifier
        if actionId == "ANSWER" || actionId == "DECLINE" {
            let info = response.notification.request.content.userInfo
            let from = info["from"] as? String ?? ""
            let callType = info["callType"] as? String ?? "audio"
            let callerName = info["callerName"] as? String ?? ""
            let callId = info["callId"] as? String ?? ""
            Task { @MainActor in
                CallManager.shared.incomingFromPush(from: from, callType: callType, callerName: callerName, callId: callId)
                // 冷启动时 SessionStore.restoreSession() 才刚异步发起 socket 连接/鉴权：此刻直接
                // emit 可能打到 nil socket（reject 空发）或抢在鉴权完成前发送（accept 丢失）。
                // 等 socket 就绪（有限超时，避免用户被卡在系统通知上）再发送动作，最后才调用
                // completionHandler——过早调用 iOS 可能在动作真正发出前就把 App 挂起（NOTIFY-002 F2）。
                await Self.awaitSocketReady(timeout: 8)
                if actionId == "ANSWER" {
                    CallManager.shared.accept()
                } else {
                    CallManager.shared.reject()
                }
                completionHandler()
            }
            return
        }

        let info = response.notification.request.content.userInfo
        if let conversationId = info["conversationId"] as? String, !conversationId.isEmpty {
            // 点击通知 → 路由到对应会话。
            // 冷启动时序修复：App 刚启动时 RootView 还在 .loading（SessionStore 异步恢复），
            // ConversationListView 尚未挂载，NotificationCenter 广播会丢。因此：
            // 1) 总是缓存 pendingConversationId（供挂载后消费）；
            // 2) 同时照常广播——正常启动（UI 已就绪）时立即响应；
            // 3) ConversationListView 每次挂载时检查缓存兜底冷启动场景。
            PendingConversation.shared.set(conversationId)
            NotificationCenter.default.post(
                name: .vxinOpenConversation, object: nil,
                userInfo: ["conversationId": conversationId]
            )
        } else if let callId = info["callId"] as? String, !callId.isEmpty {
            // 2026-08-30 修复：来电通知本体被点击（不是"接听"/"拒绝"这两个 action 按钮，
            // actionIdentifier 是系统默认的 UNNotificationDefaultActionIdentifier，走不到上面
            // ANSWER/DECLINE 分支）——此前这里完全没处理，用户点进通知只是打开了 App，
            // 没有任何来电界面/应答逻辑被触发，形成"锁屏有通知、点进去却不能接听"。
            // 来电推送 payload 不带 conversationId（只有 from/callerName/callId/callType），
            // 所以上面那个分支天然不会命中，需要单独判断。
            // 只重建 incoming 状态、不自动 accept/reject——交给用户在 App 内的来电界面自己决定，
            // 跟 ANSWER/DECLINE 分支的语义不同（那两个是已经做了选择，这里只是"打开来看看"）。
            let from = info["from"] as? String ?? ""
            let callType = info["callType"] as? String ?? "audio"
            let callerName = info["callerName"] as? String ?? ""
            Task { @MainActor in
                CallManager.shared.incomingFromPush(from: from, callType: callType, callerName: callerName, callId: callId)
            }
        }
        completionHandler()
    }

    /// 等待 SocketService 连接就绪（或超时放行）。见上方 didReceive 里的 F2 说明。
    @MainActor
    private static func awaitSocketReady(timeout: TimeInterval) async {
        let socket = SocketService.shared
        if socket.status.value == .connected { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            var resumed = false
            var cancellable: AnyCancellable?
            func resumeOnce() {
                DispatchQueue.main.async {
                    guard !resumed else { return }
                    resumed = true
                    cancellable?.cancel()
                    continuation.resume()
                }
            }
            cancellable = socket.status
                .receive(on: DispatchQueue.main)
                .filter { $0 == .connected }
                .first()
                .sink { _ in resumeOnce() }
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { resumeOnce() }
        }
    }
}

extension Notification.Name {
    static let vxinOpenConversation = Notification.Name("vxin.openConversation")
}
