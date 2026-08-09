import Foundation
import UIKit
import UserNotifications
import FirebaseMessaging

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
        print("[Push] FCM token = \(token)")
        if KeychainStore.shared.isLoggedIn {
            Task { await repo.register(token: token) }
        }
    }

    /// 登录/恢复会话后调用：请求通知授权 + 注册；主动拉取当前 FCM token，
    /// 覆盖「token 曾被服务端因失效删除但 onToken 未重触发」的场景。
    func requestAuthorizationAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
        Task { await fetchAndRegister() }
    }

    /// App 每次进入前台时调用，主动刷新确保服务端 token 有效。
    /// 这是「好友发我有通知、我发好友无通知」问题的根治手段：
    /// 好友 token 在服务端被删除（FCM 失效触发）后只要重新打开 App 就会重新注册。
    func refreshRegistrationIfNeeded() {
        guard KeychainStore.shared.isLoggedIn else { return }
        Task { await fetchAndRegister() }
    }

    /// 登出时注销当前 token
    func unregister() async {
        if let token = latestToken { await repo.delete(token: token) }
        latestToken = nil
    }

    // MARK: - Private

    /// 主动从 Firebase 取当前 FCM token 并上报后端（幂等，后端 ON CONFLICT 更新）。
    private func fetchAndRegister() async {
        do {
            let token = try await Messaging.messaging().token()
            latestToken = token
            await repo.register(token: token)
            print("[Push] token 已注册 prefix=\(token.prefix(12))")
        } catch {
            print("[Push] fetchAndRegister 失败：\(error.localizedDescription)")
        }
    }
}
