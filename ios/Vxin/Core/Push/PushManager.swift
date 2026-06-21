import Foundation
import UIKit
import UserNotifications

/// FCM token 注册/注销 + 通知授权。与 Android PushManager 等价。
/// FCM token 由 AppDelegate 的 MessagingDelegate 回调注入 onToken。
final class PushManager {
    static let shared = PushManager()
    private init() {}

    private let repo = NotificationRepository.shared
    private var latestToken: String?

    /// MessagingDelegate 回调：拿到/刷新 FCM token
    func onToken(_ token: String) {
        latestToken = token
        print("[Push] FCM token = \(token)")   // 便于用 Firebase 控制台对单设备发测试推送
        if KeychainStore.shared.isLoggedIn {
            Task { await repo.register(token: token) }
        }
    }

    /// 登录/恢复会话后调用：请求通知授权 + 注册远程通知；若已有 token 直接注册
    func requestAuthorizationAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
        if let token = latestToken, KeychainStore.shared.isLoggedIn {
            Task { await repo.register(token: token) }
        }
    }

    /// 登出时注销当前 token
    func unregister() async {
        if let token = latestToken { await repo.delete(token: token) }
    }
}
