import Foundation

/// An uncertain response keeps the request ID so a manual retry resolves to the first result.
final class RequestKeys {
    static let shared = RequestKeys()
    private let lock = NSLock()
    private var pending: [String: String] = [:]

    static func accountScope() -> String {
        let owner = KeychainStore.shared.snapshot()
        return "\(owner.origin):\(AccountStore.shared.activeId() ?? ""):\(owner.identityEpoch)"
    }

    func key(scope: String, operation: String, payload: Data) -> String {
        let fingerprint = "\(scope)\u{0}\(operation)\u{0}\(payload.base64EncodedString())"
        lock.lock(); defer { lock.unlock() }
        if let existing = pending[fingerprint] { return existing }
        let created = UUID().uuidString
        pending[fingerprint] = created
        return created
    }

    func complete(scope: String, operation: String, payload: Data, key: String) {
        let fingerprint = "\(scope)\u{0}\(operation)\u{0}\(payload.base64EncodedString())"
        lock.lock(); defer { lock.unlock() }
        if pending[fingerprint] == key { pending.removeValue(forKey: fingerprint) }
    }
}
