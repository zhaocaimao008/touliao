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
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // 占位/未配置或模拟器无 APNs 时会进这里，忽略
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
            // 点击通知 → 路由到对应会话（后续接入导航）
            NotificationCenter.default.post(
                name: .vxinOpenConversation, object: nil,
                userInfo: ["conversationId": conversationId]
            )
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
