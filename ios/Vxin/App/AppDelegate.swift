import UIKit
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
        // 前台也展示横幅 + 声音
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
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
}

extension Notification.Name {
    static let vxinOpenConversation = Notification.Name("vxin.openConversation")
}
