import Foundation

/// Request ordering plus identity epoch; events contain no values to merge.
@MainActor
final class SocialReadGuard {
    struct Stamp { let sequence: UInt64; let revision: UInt64 }
    private let identity: () -> UInt64
    private let revision: () -> UInt64
    private let owner: UInt64
    private var sequence: UInt64 = 0
    init(identity: @escaping () -> UInt64 = { KeychainStore.shared.snapshot().identityEpoch },
         revision: @escaping () -> UInt64 = { SocketService.shared.socialState.value }) {
        self.identity = identity; self.revision = revision; owner = identity()
    }
    func begin() -> Stamp? {
        guard identity() == owner else { return nil }
        sequence += 1
        return Stamp(sequence: sequence, revision: revision())
    }
    func current(_ stamp: Stamp) -> Bool { identity() == owner && sequence == stamp.sequence && revision() == stamp.revision }
}
