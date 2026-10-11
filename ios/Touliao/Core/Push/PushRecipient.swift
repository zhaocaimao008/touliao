import Foundation
import UserNotifications

enum PushRecipient {
    static func matches(_ recipientId: String?, currentUserId: String?, loggedIn: Bool) -> Bool {
        loggedIn && recipientId?.isEmpty == false && recipientId == currentUserId
    }

    static func accepts(_ info: [AnyHashable: Any]) -> Bool {
        matches(info["recipientId"] as? String, currentUserId: AccountStore.shared.activeId(), loggedIn: KeychainStore.shared.isLoggedIn)
    }

    static func belongsToConversation(_ info: [AnyHashable: Any], recipientId: String, conversationId: String) -> Bool {
        info["recipientId"] as? String == recipientId && info["conversationId"] as? String == conversationId
    }

    /// Respect the notification sound preference, including when suppressing a visible-chat banner.
    static func foregroundOptions(_ info: [AnyHashable: Any], visibleConversationId: String?) -> UNNotificationPresentationOptions {
        let conversationId = info["conversationId"] as? String ?? ""
        let isCall = (info["callId"] as? String)?.isEmpty == false || info["type"] as? String == "call"
        let silent = info["sound"] as? String == "false" || info["sound"] as? Bool == false
        let sound: UNNotificationPresentationOptions = silent ? [] : [.sound]
        if isCall || conversationId.isEmpty { return sound }
        if conversationId == visibleConversationId { return sound }
        let visible: UNNotificationPresentationOptions = [.banner, .list]
        return visible.union(sound)
    }
}
