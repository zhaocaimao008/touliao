package com.touliao.app.core.network

import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Retain the same ID across an uncertain response; retire it only after confirmed success. */
@Singleton
class RequestKeys @Inject constructor() {
    private val pending = mutableMapOf<String, String>()

    @Synchronized fun key(scope: String, operation: String, payload: String): String =
        pending.getOrPut("$scope\u0000$operation\u0000$payload") { UUID.randomUUID().toString() }

    @Synchronized fun complete(scope: String, operation: String, payload: String, key: String) {
        val fingerprint = "$scope\u0000$operation\u0000$payload"
        if (pending[fingerprint] == key) pending.remove(fingerprint)
    }
}
