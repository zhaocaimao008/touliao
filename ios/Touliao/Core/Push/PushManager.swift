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
    private var latestApnsHex: String?

    /// AppDelegate 拿到 APNs device token 时缓存（未登录也能存，登录后补报）。
    func setApnsToken(_ hex: String) {
        latestApnsHex = hex.isEmpty ? latestApnsHex : hex
    }

    /// MessagingDelegate 回调：拿到/刷新 FCM token
    func onToken(_ token: String) {
        latestToken = token
        // 只打印前缀，避免完整 token 泄漏到日志（token 等同推送凭据）
        print("[Push] FCM token prefix = \(token.prefix(12))…")
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
        // 补报 APNs 原始 token：可能早于登录就拿到（未登录时 AppDelegate 只缓存不报）
        registerApnsTokenIfNeeded()
    }

    /// 登录后补报 APNs 原始 token（此前未登录时 AppDelegate 拿到 APNs token 也上报不了）。
    func registerApnsTokenIfNeeded() {
        guard KeychainStore.shared.isLoggedIn else { return }
        // 主动取当前 APNs token（无公开 API 可取回，但 registerForRemoteNotifications
        // 会在授权后回调 didRegister；此处仅做一次兜底上报缓存值）
        if let token = latestApnsHex {
            Task { await NotificationRepository.shared.register(token: token, platform: "ios_apns") }
        }
    }

    /// App 每次进入前台时调用，主动刷新确保服务端 token 有效。
    /// 这是「好友发我有通知、我发好友无通知」问题的根治手段：
    /// 好友 token 在服务端被删除（FCM 失效触发）后只要重新打开 App 就会重新注册。
    func refreshRegistrationIfNeeded() {
        guard KeychainStore.shared.isLoggedIn else { return }
        Task { await fetchAndRegister() }
    }

    /// 登出时注销当前 token（FCM + APNs 都要删，否则登出后旧账号推送继续到达本机）
    func unregister() async {
        if let token = latestToken { await repo.delete(token: token) }
        if let apns = latestApnsHex { await repo.delete(token: apns) }
        latestToken = nil
        latestApnsHex = nil
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
