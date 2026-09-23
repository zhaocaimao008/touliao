import Foundation
import Security

struct StoredAccount: Codable, Identifiable, Equatable {
    let id: String
    var username: String = ""
    var avatar: String = ""
    let token: String
}

/// 多账号本地存储(含 token，存 Keychain)。支持秒切换。
/// 账号列表与当前账号按服务器 origin 分区（对齐 Android AccountStore）：切换服务器后
/// 只能看到/切到该服务器上登录过的账号，别的服务器的 token 不会被装进 KeychainStore（审计 F02）。
final class AccountStore {
    static let shared = AccountStore()
    private init() {}

    private let service = "com.touliao.app"
    private let legacyAccount = "touliao.accounts"
    private let legacyActiveKey = "touliao_active_account_id"
    private var origin: String { ServerConfig.shared.origin }
    private var account: String { "\(legacyAccount)|\(origin)" }
    private var activeKey: String { "\(legacyActiveKey)|\(origin)" }

    func accounts() -> [StoredAccount] {
        migrateLegacy()
        guard let data = read(account), let list = try? JSONDecoder().decode([StoredAccount].self, from: data) else { return [] }
        return list
    }

    func activeId() -> String? { migrateLegacy(); return UserDefaults.standard.string(forKey: activeKey) }

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
        ConversationCache.remove(id)
        save(accounts().filter { $0.id != id })
        if activeId() == id { UserDefaults.standard.removeObject(forKey: activeKey) }
    }

    /// 升级前的未分区数据归入当前生效服务器（与 KeychainStore 的旧 token 处理一致），只迁移一次。
    private func migrateLegacy() {
        guard let legacy = read(legacyAccount) else { return }
        if read(account) == nil, let list = try? JSONDecoder().decode([StoredAccount].self, from: legacy) {
            save(list)
            if let id = UserDefaults.standard.string(forKey: legacyActiveKey) { UserDefaults.standard.set(id, forKey: activeKey) }
        }
        delete(legacyAccount)
        UserDefaults.standard.removeObject(forKey: legacyActiveKey)
    }

    // MARK: - Keychain
    private func save(_ list: [StoredAccount]) {
        guard let data = try? JSONEncoder().encode(list) else { return }
        delete(account)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    private func read(_ account: String) -> Data? {
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

    private func delete(_ account: String) {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ] as CFDictionary)
    }
}
