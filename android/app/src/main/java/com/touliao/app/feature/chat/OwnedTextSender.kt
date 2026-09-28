package com.touliao.app.feature.chat

import com.touliao.app.core.storage.OutboxOwner
import com.touliao.app.core.storage.OutboxStore
import com.touliao.app.core.storage.TokenStore
import com.touliao.app.data.model.Message

/** The VM and tests share this actual send/ACK persistence path. */
internal suspend fun sendOwnedText(
    message: Message,
    owner: OutboxOwner,
    credential: TokenStore.Snapshot,
    tokens: TokenStore,
    outbox: OutboxStore,
    send: suspend (TokenStore.Snapshot) -> Result<Message>,
    onSuccess: (Message) -> Unit,
    onFailure: () -> Unit,
    onRejected: (String) -> Unit = { onFailure() },
) {
    if (message.sender_id != owner.accountId || !tokens.isCurrent(credential)) return
    val result = send(credential)
    tokens.withCurrent(credential) {
        result.onSuccess { real ->
            if (real.sender_id != owner.accountId || real.conversation_id != message.conversation_id) return@onSuccess
            outbox.remove(message.conversation_id, message.id, owner)
            onSuccess(real)
        }.onFailure { e ->
            if (e is com.touliao.app.core.realtime.ServerRejectedException) {
                // 服务端明确拒收：不进发件箱、不自动重发，把原因告诉用户
                outbox.remove(message.conversation_id, message.id, owner)
                onRejected(e.message.orEmpty())
            } else {
                outbox.upsert(message.conversation_id, message, owner)
                onFailure()
            }
        }
    }
}
