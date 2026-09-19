import Foundation

/// Local presentation filters only; preserve the full list and its unread state.
enum ConversationFilter: String, CaseIterable {
    case all = "全部"
    case unread = "未读"
    case groups = "群聊"

    func includes(_ conversation: Conversation) -> Bool {
        switch self {
        case .all: return true
        case .unread: return conversation.unreadCount > 0 || conversation.manuallyUnread == 1
        case .groups: return conversation.type == "group"
        }
    }
}
