import Foundation
import Security

/// Bearer token 安全存储（Keychain）。对应 Android 的 EncryptedSharedPreferences。
final class KeychainStore {
    static let shared = KeychainStore()
    private let readToken: (() -> String?)?
    private let writeToken: ((String?) -> Void)?
    init(readToken: (() -> String?)? = nil, writeToken: ((String?) -> Void)? = nil) {
        self.readToken = readToken
        self.writeToken = writeToken
    }
    private let lock = NSRecursiveLock()
    private var revision: UInt64 = 0
    private(set) var identityEpoch: UInt64 = 0
    struct Snapshot: Equatable {
        let token: String?
        let revision: UInt64
        let identityEpoch: UInt64
    }
    func synchronized<T>(_ action: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return action()
    }
    func beginIdentityChange() { synchronized { identityEpoch += 1 } }
    func snapshot() -> Snapshot { synchronized { Snapshot(token: token, revision: revision, identityEpoch: identityEpoch) } }
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

    var token: String? {
        get { synchronized { if let readToken { return readToken() }; return read() } }
        set {
            synchronized {
                revision += 1
                if let writeToken { writeToken(newValue) }
                else if let newValue { save(newValue) } else { delete() }
            }
        }
    }

    var isLoggedIn: Bool { token?.isEmpty == false }

    func clear() { token = nil }

    private func save(_ value: String) {
        delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    private func read() -> String? {
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

    private func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
