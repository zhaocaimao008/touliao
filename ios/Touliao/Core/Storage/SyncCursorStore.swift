import Foundation

/// 当前设备按账号、会话隔离的同步游标；只在一页事件成功应用后前移。
final class SyncCursorStore {
    static let shared = SyncCursorStore()
    private let defaults = UserDefaults.standard
    private init() {}
    private func key(_ accountId: String, _ conversationId: String) -> String {
        "sync_cursor_v1:\(accountId):\(conversationId)"
    }
    func load(accountId: String, conversationId: String) -> Int64 {
        max(0, Int64(defaults.object(forKey: key(accountId, conversationId)) as? Int ?? 0))
    }
    func save(accountId: String, conversationId: String, sequence: Int64) {
        let storageKey = key(accountId, conversationId)
        let previous = Int64(defaults.object(forKey: storageKey) as? Int ?? 0)
        if sequence > previous { defaults.set(Int(sequence), forKey: storageKey) }
    }
}
