package com.touliao.app.core.network

import com.touliao.app.core.storage.TokenStore
import okhttp3.OkHttpClient

/** Cancel running/queued work and retire pooled connections synchronously on a server switch. */
fun OkHttpClient.cancelOnOriginChange(tokens: TokenStore): OkHttpClient = apply {
    tokens.onOriginChange {
        dispatcher.cancelAll()
        connectionPool.evictAll()
    }
}
