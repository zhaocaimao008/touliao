import Foundation
import Security

/// Bearer token 安全存储（Keychain）。对应 Android 的 EncryptedSharedPreferences。
/// token 与签发它的服务器 origin 一起落盘；只有 origin 与当前生效服务器一致时才读得出来（审计 F02）。
final class KeychainStore {
    static let shared = KeychainStore()
    private let readToken: (() -> String?)?
    private let writeToken: ((String?) -> Void)?
    private let currentOriginProvider: (() -> String)?
    /// 注入存储（测试）时，token 的归属 origin 只保存在内存里。
    private var injectedTokenOrigin: String?
    init(readToken: (() -> String?)? = nil, writeToken: ((String?) -> Void)? = nil, currentOrigin: (() -> String)? = nil) {
        self.readToken = readToken
        self.writeToken = writeToken
        self.currentOriginProvider = currentOrigin
    }
    var currentOrigin: String { currentOriginProvider?() ?? ServerConfig.shared.origin }
    private let lock = NSRecursiveLock()
    private var revision: UInt64 = 0
    private(set) var identityEpoch: UInt64 = 0
    struct Snapshot: Equatable {
        let token: String?
        let revision: UInt64
        let identityEpoch: UInt64
        let origin: String
    }
    func synchronized<T>(_ action: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return action()
    }
    func beginIdentityChange() { synchronized { identityEpoch += 1 } }
    func snapshot() -> Snapshot { synchronized { Snapshot(token: token, revision: revision, identityEpoch: identityEpoch, origin: currentOrigin) } }
    func isCurrent(_ snapshot: Snapshot) -> Bool { synchronized { self.snapshot() == snapshot } }
    @discardableResult func withCurrent(_ snapshot: Snapshot, _ action: () -> Void) -> Bool {
        synchronized {
            guard isCurrent(snapshot) else { return false }
            action(); return true
        }
    }
    func invalidate(_ snapshot: Snapshot) -> Snapshot? {
        synchronized {
            guard snapshot.token != nil, isCurrent(snapshot) else { return nil }
            token = nil
            return self.snapshot()
        }
    }
    @discardableResult func installReplacement(_ expected: Snapshot, token: String, onInstalled: () -> Void) -> Bool {
        synchronized {
            guard !token.isEmpty, isCurrent(expected) else { return false }
            self.token = token
            onInstalled()
            return true
        }
    }

    private let service = "com.touliao.app"
    private let account = "touliao.token"
    private let originAccount = "touliao.token.origin"

    var token: String? {
        get {
            synchronized {
                guard let raw = readToken.map({ $0() }) ?? read(account) else { return nil }
                let origin = currentOrigin
                guard let owner = tokenOrigin else {
                    // 升级前保存的 token 没有归属记录：按当前生效服务器签发处理并补记一次，
                    // 之后任何服务器切换都会清除它。
                    tokenOrigin = origin
                    return raw
                }
                return owner == origin ? raw : nil
            }
        }
        set {
            synchronized {
                revision += 1
                if let writeToken { writeToken(newValue) }
                else if let newValue { save(newValue, account) } else { delete(account) }
                tokenOrigin = newValue == nil ? nil : currentOrigin
            }
        }
    }

    var isLoggedIn: Bool { token?.isEmpty == false }

    func clear() { token = nil }

    private var tokenOrigin: String? {
        get { writeToken != nil ? injectedTokenOrigin : read(originAccount) }
        set {
            if writeToken != nil { injectedTokenOrigin = newValue }
            else if let newValue { save(newValue, originAccount) } else { delete(originAccount) }
        }
    }

    private func save(_ value: String, _ account: String) {
        delete(account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    private func read(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else { return nil }
        return value
    }

    private func delete(_ account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
