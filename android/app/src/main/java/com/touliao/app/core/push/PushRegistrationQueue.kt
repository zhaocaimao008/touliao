package com.touliao.app.core.push

import com.touliao.app.core.storage.TokenStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class PushRegistrationQueue(private val credentials: TokenStore) {
    private val mutex = Mutex()

    // A switch must drain an in-flight registration before removing its ownership.
    suspend fun run(owner: TokenStore.Snapshot, operation: suspend () -> Unit): Boolean = mutex.withLock {
        if (owner.token.isNullOrBlank() || !credentials.isCurrent(owner)) return@withLock false
        operation()
        true
    }
}
