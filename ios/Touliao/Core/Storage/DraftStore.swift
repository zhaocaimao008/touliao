import Foundation

struct DraftOwner: Equatable {
    let server: String
    let accountId: String
    let identityEpoch: UInt64
    let generation: UInt64
}

/// Text drafts only; legacy vxin_draft_<conversation> rows have no proven owner.
/// Keep them quarantined without assigning or deleting another account's data.
final class DraftStore {
    static let shared = DraftStore(defaults: .standard, environment: {
        (ServerConfig.shared.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")), KeychainStore.shared.snapshot().identityEpoch)
    })
    private let defaults: UserDefaults
    private let environment: (() -> (String, UInt64))?
    private let lock = NSRecursiveLock()
    private var active: DraftOwner?
    private var generation: UInt64 = 0
    init(defaults: UserDefaults = .standard, environment: (() -> (String, UInt64))? = nil) {
        self.defaults = defaults
        self.environment = environment
    }
    @discardableResult func activate(server: String, accountId: String, identityEpoch: UInt64) -> DraftOwner {
        lock.lock(); defer { lock.unlock() }
        let normalized = server.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if let active, active.server == normalized, active.accountId == accountId, active.identityEpoch == identityEpoch { return active }
        generation += 1
        let owner = DraftOwner(server: normalized, accountId: accountId, identityEpoch: identityEpoch, generation: generation)
        active = owner
        return owner
    }
    func invalidate() { lock.lock(); defer { lock.unlock() }; active = nil; generation += 1 }
    func capture() -> DraftOwner? { lock.lock(); defer { lock.unlock() }; return active }
    private func current(_ owner: DraftOwner?, environment now: (String, UInt64)?) -> Bool {
        guard let owner, owner == active, !owner.accountId.isEmpty, !owner.server.isEmpty else { return false }
        if let now { return now.0 == owner.server && now.1 == owner.identityEpoch }
        return true
    }
    private func key(_ owner: DraftOwner, _ conversation: String) -> String {
        "vxin_draft_v2:" + [owner.server, owner.accountId, conversation].map { "\($0.utf8.count):\($0)" }.joined()
    }
    func get(_ conversationId: String) -> String { get(conversationId, owner: capture()) }
    func get(_ conversationId: String, owner: DraftOwner?) -> String {
        let now = environment?() // Credential lock precedes the draft lock.
        lock.lock(); defer { lock.unlock() }
        guard !conversationId.isEmpty, current(owner, environment: now), let owner else { return "" }
        return defaults.string(forKey: key(owner, conversationId)) ?? ""
    }
    func set(_ conversationId: String, _ text: String, owner: DraftOwner?) {
        let now = environment?()
        lock.lock(); defer { lock.unlock() }
        guard !conversationId.isEmpty, current(owner, environment: now), let owner else { return }
        let storageKey = key(owner, conversationId)
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { defaults.removeObject(forKey: storageKey) }
        else { defaults.set(text, forKey: storageKey) }
    }
    func clear(_ conversationId: String, owner: DraftOwner?) { set(conversationId, "", owner: owner) }
}
