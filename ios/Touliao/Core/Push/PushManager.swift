import Foundation
import UIKit
import UserNotifications
import FirebaseMessaging

final class PushManager {
    static let shared = PushManager()
    private init() {}

    private let repo = NotificationRepository.shared
    private let operations = PushRegistrationQueue()
    private let lock = NSLock()
    private var latestApnsHex: String?

    func setApnsToken(_ hex: String) {
        guard !hex.isEmpty else { return }
        lock.lock(); latestApnsHex = hex; lock.unlock()
        registerApnsTokenIfNeeded()
    }

    private func apnsToken() -> String? {
        lock.lock(); defer { lock.unlock() }
        return latestApnsHex
    }

    func onToken(_ token: String) {
        register { owner in await self.repo.register(token: token, owner: owner) }
    }

    func requestAuthorizationAndRegister() {
        let owner = KeychainStore.shared.snapshot()
        guard owner.token?.isEmpty == false else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                guard KeychainStore.shared.isCurrent(owner) else { return }
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
        refreshRegistrationIfNeeded()
    }

    func registerApnsTokenIfNeeded() {
        guard let token = apnsToken() else { return }
        register { owner in await self.repo.register(token: token, platform: "ios_apns", owner: owner) }
    }

    func refreshRegistrationIfNeeded() {
        registerApnsTokenIfNeeded()
        let owner = KeychainStore.shared.snapshot()
        guard owner.token?.isEmpty == false else { return }
        Task {
            do {
                let token = try await Messaging.messaging().token()
                await operations.run(owner: owner) { await self.repo.register(token: token, owner: owner) }
            } catch { /* Retry on the next foreground transition or token callback. */ }
        }
    }

    private func register(_ action: @escaping (KeychainStore.Snapshot) async -> Void) {
        let owner = KeychainStore.shared.snapshot()
        guard owner.token?.isEmpty == false else { return }
        Task { await operations.run(owner: owner) { await action(owner) } }
    }

    func unregister() async {
        let owner = KeychainStore.shared.snapshot()
        await operations.run(owner: owner) { await self.repo.deleteAll(owner: owner) }
        // APNs is app-scoped. Keep its cached token for the next account.
        KeychainStore.shared.withCurrent(owner) { clearDisplayedNotifications() }
    }

    func clearDisplayedNotifications() {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        _ = PendingConversation.shared.take()
    }
}
