import Foundation
import Security

struct StoredAccount: Codable, Identifiable, Equatable {
    let id: String
    var username: String = ""
    var avatar: String = ""
    let token: String
}

/// 多账号本地存储(含 token，存 Keychain)。支持秒切换。
final class AccountStore {
    static let shared = AccountStore()
    private init() {}

    private let service = "com.vxin.app"
    private let account = "vxin.accounts"
    private let activeKey = "vxin_active_account_id"

    func accounts() -> [StoredAccount] {
        guard let data = read(), let list = try? JSONDecoder().decode([StoredAccount].self, from: data) else { return [] }
        return list
    }

    func activeId() -> String? { UserDefaults.standard.string(forKey: activeKey) }

    func upsertActive(_ acc: StoredAccount) {
        var list = accounts().filter { $0.id != acc.id }
        list.append(acc)
        save(list)
        UserDefaults.standard.set(acc.id, forKey: activeKey)
    }

    func token(for id: String) -> String? { accounts().first { $0.id == id }?.token }

    /// 更新指定账号已存 token（改密后旧 token 失效、拿到新 token 时用）。
    func updateToken(_ id: String, _ token: String) {
        let list = accounts().map { acc -> StoredAccount in
            acc.id == id ? StoredAccount(id: acc.id, username: acc.username, avatar: acc.avatar, token: token) : acc
        }
        save(list)
    }

    func setActive(_ id: String) { UserDefaults.standard.set(id, forKey: activeKey) }

    func remove(_ id: String) {
        save(accounts().filter { $0.id != id })
        if activeId() == id { UserDefaults.standard.removeObject(forKey: activeKey) }
    }

    // MARK: - Keychain
    private func save(_ list: [StoredAccount]) {
        guard let data = try? JSONEncoder().encode(list) else { return }
        delete()
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    private func read() -> Data? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    private func delete() {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ] as CFDictionary)
    }
}
