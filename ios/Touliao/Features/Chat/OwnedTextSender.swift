import Foundation

/// Shared by the VM and isolated tests; transport is the only substituted boundary.
@MainActor
func sendOwnedText(message: Message, owner: OutboxOwner, credential: KeychainStore.Snapshot,
                   credentials: KeychainStore, outbox: OutboxStore,
                   send: (KeychainStore.Snapshot) async -> Result<Message, Error>,
                   onSuccess: (Message) -> Void, onFailure: () -> Void,
                   onRejected: ((String) -> Void)? = nil) async {
    guard message.senderId == owner.accountId, credentials.isCurrent(credential) else { return }
    let result = await send(credential)
    credentials.withCurrent(credential) {
        switch result {
        case .success(let real):
            guard real.senderId == owner.accountId, real.conversationId == message.conversationId else { return }
            outbox.remove(message.conversationId, message.id, owner: owner)
            onSuccess(real)
        case .failure(let error):
            if case SocketError.rejected(let reason) = error, let onRejected {
                // 服务端明确拒收：不进发件箱、不自动重发，把原因告诉用户
                outbox.remove(message.conversationId, message.id, owner: owner)
                onRejected(reason)
            } else {
                outbox.upsert(message.conversationId, message, owner: owner)
                onFailure()
            }
        }
    }
}
