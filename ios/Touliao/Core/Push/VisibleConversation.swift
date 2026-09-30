import Foundation

/// 当前正在聊天页里查看的会话。前台收到推送时，只有正在看的这个会话不弹横幅
/// （消息已实时显示在页面上），其他会话照常弹横幅。
final class VisibleConversation {
    static let shared = VisibleConversation()
    private init() {}

    private let lock = NSLock()
    private var current: String?

    func enter(_ conversationId: String) {
        lock.lock(); defer { lock.unlock() }
        current = conversationId
    }

    /// 只清除自己：从 A 进入 B 时，B 的 enter 可能先于 A 的 leave 到达。
    func leave(_ conversationId: String) {
        lock.lock(); defer { lock.unlock() }
        if current == conversationId { current = nil }
    }

    var id: String? {
        lock.lock(); defer { lock.unlock() }
        return current
    }
}
