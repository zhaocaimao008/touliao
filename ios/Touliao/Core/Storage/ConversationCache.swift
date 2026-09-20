import Foundation
import CryptoKit

/// Metadata is scoped to both account and server; writes are atomic and protected at rest.
enum ConversationCache {
    private static var directory: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0] }
    static func file(_ id: String, _ origin: String, directory: URL) -> URL {
        let key = SHA256.hash(data: Data((origin + "\n" + id).utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("conversations-\(key).json")
    }
    static func load() -> [Conversation] {
        guard let id = AccountStore.shared.activeId() else { return [] }
        return load(id: id, origin: ServerConfig.shared.baseURL, directory: directory)
    }
    static func load(id: String, origin: String, directory: URL) -> [Conversation] {
        guard let data = try? Data(contentsOf: file(id, origin, directory: directory)) else { return [] }
        return (try? JSONDecoder().decode([Conversation].self, from: data)) ?? []
    }
    static func save(_ list: [Conversation], id: String, origin: String) {
        save(list, id: id, origin: origin, directory: directory)
    }
    static func save(_ list: [Conversation], id: String, origin: String, directory: URL) {
        let safe = list.map { value -> Conversation in
            var item = value
            item.lastMessage = nil; item.lastMessageType = nil; item.lastSenderName = nil
            return item
        }
        guard let data = try? JSONEncoder().encode(safe) else { return }
        try? data.write(to: file(id, origin, directory: directory), options: [.atomic, .completeFileProtection])
    }
    static func remove(_ id: String) {
        try? FileManager.default.removeItem(at: file(id, ServerConfig.shared.baseURL, directory: directory))
    }
}
