import Foundation

enum PushRecipient {
    static func matches(_ recipientId: String?, currentUserId: String?, loggedIn: Bool) -> Bool {
        loggedIn && recipientId?.isEmpty == false && recipientId == currentUserId
    }

    static func accepts(_ info: [AnyHashable: Any]) -> Bool {
        matches(info["recipientId"] as? String, currentUserId: AccountStore.shared.activeId(), loggedIn: KeychainStore.shared.isLoggedIn)
    }
}
