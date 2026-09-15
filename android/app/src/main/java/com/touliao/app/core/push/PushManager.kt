package com.touliao.app.core.push

import android.content.Context
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.touliao.app.core.di.AppScope
import com.touliao.app.core.storage.TokenStore
import com.touliao.app.data.api.NotificationApi
import com.touliao.app.data.model.DeleteTokenRequest
import com.touliao.app.data.model.DeviceTokenRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

@Singleton
class PushManager @Inject constructor(
    private val notificationApi: NotificationApi,
    private val tokenStore: TokenStore,
    @AppScope private val scope: CoroutineScope,
    @ApplicationContext private val context: Context,
) {
    private val operations = PushRegistrationQueue(tokenStore)
    @Volatile private var latestGeTuiCid: String? = null

    fun registerCurrentToken() = register { owner ->
        val cid = fetchGeTuiCid() ?: latestGeTuiCid
        if (!cid.isNullOrBlank()) report(cid, "getui", owner)
        fetchToken()?.let { report(it, "android", owner) }
    }

    fun onNewToken(fcm: String) = register { owner -> report(fcm, "android", owner) }

    fun registerGeTuiCid(cid: String) {
        if (cid.isBlank()) return
        latestGeTuiCid = cid
        register { owner -> report(cid, "getui", owner) }
    }

    private fun register(action: suspend (TokenStore.Snapshot) -> Unit) {
        val owner = tokenStore.snapshot()
        if (owner.token.isNullOrBlank()) return
        scope.launch { operations.run(owner) { action(owner) } }
    }

    private suspend fun report(token: String, platform: String, owner: TokenStore.Snapshot) {
        if (!tokenStore.isCurrent(owner)) return
        try {
            notificationApi.registerToken(DeviceTokenRequest(token, platform), owner)
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { Log.w(TAG, "Push registration failed: ${error.javaClass.simpleName}") }
    }

    suspend fun unregisterCurrentToken() {
        val owner = tokenStore.snapshot()
        operations.run(owner) {
            // An empty selector only removes destinations of this verified login session.
            try { notificationApi.deleteToken(DeleteTokenRequest(), owner) }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { Log.w(TAG, "Push removal failed: ${error.javaClass.simpleName}") }
        }
    }

    private fun fetchGeTuiCid(): String? =
        runCatching { com.igexin.sdk.PushManager.getInstance().getClientid(context) }
            .getOrNull()?.takeIf { it.isNotBlank() }

    private suspend fun fetchToken(): String? = withTimeoutOrNull(5_000) {
        try {
            suspendCancellableCoroutine { cont ->
                FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { if (cont.isActive) cont.resume(it) }
                    .addOnFailureListener { if (cont.isActive) cont.resume(null) }
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { null }
    }

    private companion object { const val TAG = "PushManager" }
}
