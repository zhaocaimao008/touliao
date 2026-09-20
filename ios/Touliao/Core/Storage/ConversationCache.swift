import Foundation
import CryptoKit

/// Metadata is scoped to both account and server; writes are atomic and protected at rest.
enum ConversationCache {
    private static func file(_ id: String, _ origin: String) -> URL {
        let key = SHA256.hash(data: Data((origin + "\n" + id).utf8)).map { String(format: "%02x", $0) }.joined()
        return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("conversations-\(key).json")
    }
    static func load() -> [Conversation] {
        guard let id = AccountStore.shared.activeId(),
              let data = try? Data(contentsOf: file(id, ServerConfig.shared.baseURL)) else { return [] }
        return (try? JSONDecoder().decode([Conversation].self, from: data)) ?? []
    }
    static func save(_ list: [Conversation], id: String, origin: String) {
        let safe = list.map { value -> Conversation in
            var item = value
            item.lastMessage = nil; item.lastMessageType = nil; item.lastSenderName = nil
            return item
        }
        guard let data = try? JSONEncoder().encode(safe) else { return }
        try? data.write(to: file(id, origin), options: [.atomic, .completeFileProtection])
    }
    static func remove(_ id: String) {
        try? FileManager.default.removeItem(at: file(id, ServerConfig.shared.baseURL))
    }
}
