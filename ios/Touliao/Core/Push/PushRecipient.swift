import Foundation
import UserNotifications

enum PushRecipient {
    static func matches(_ recipientId: String?, currentUserId: String?, loggedIn: Bool) -> Bool {
        loggedIn && recipientId?.isEmpty == false && recipientId == currentUserId
    }

    static func accepts(_ info: [AnyHashable: Any]) -> Bool {
        matches(info["recipientId"] as? String, currentUserId: AccountStore.shared.activeId(), loggedIn: KeychainStore.shared.isLoggedIn)
    }

    /// App 在前台时收到推送的展示方式：正在查看的会话只响声音（消息已在页面上），
    /// 来电由应用内来电界面接管、也只响声音；其余消息弹横幅并进通知中心。
    static func foregroundOptions(_ info: [AnyHashable: Any], visibleConversationId: String?) -> UNNotificationPresentationOptions {
        let conversationId = info["conversationId"] as? String ?? ""
        let isCall = (info["callId"] as? String)?.isEmpty == false || info["type"] as? String == "call"
        if isCall || conversationId.isEmpty { return [.sound] }
        if conversationId == visibleConversationId { return [.sound] }
        return [.banner, .list, .sound]
    }
}
