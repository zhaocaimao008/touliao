import Foundation

/// Shared by the VM and isolated tests; transport is the only substituted boundary.
@MainActor
func sendOwnedText(message: Message, owner: OutboxOwner, credential: KeychainStore.Snapshot,
                   credentials: KeychainStore, outbox: OutboxStore,
                   send: (KeychainStore.Snapshot) async -> Result<Message, Error>,
                   onSuccess: (Message) -> Void, onFailure: () -> Void) async {
    guard message.senderId == owner.accountId, credentials.isCurrent(credential) else { return }
    let result = await send(credential)
    credentials.withCurrent(credential) {
        switch result {
        case .success(let real):
            guard real.senderId == owner.accountId, real.conversationId == message.conversationId else { return }
            outbox.remove(message.conversationId, message.id, owner: owner)
            onSuccess(real)
        case .failure:
            outbox.upsert(message.conversationId, message, owner: owner)
            onFailure()
        }
    }
}
