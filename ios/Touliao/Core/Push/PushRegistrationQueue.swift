import Foundation

actor PushRegistrationQueue {
    private let credentials: KeychainStore
    private var tail: Task<Void, Never>?
    init(credentials: KeychainStore = .shared) { self.credentials = credentials }

    // Actors alone are reentrant across await. Chain tasks to drain an in-flight
    // registration before the switch deletes the old session's destinations.
    func run(owner: KeychainStore.Snapshot, operation: @escaping () async -> Void) async {
        let previous = tail
        let task = Task {
            await previous?.value
            guard owner.token?.isEmpty == false, credentials.isCurrent(owner) else { return }
            await operation()
        }
        tail = task
        await task.value
    }
}
