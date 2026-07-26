package com.vxin.app.core.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.vxin.app.core.di.AppScope
import com.vxin.app.core.storage.TokenStore
import com.vxin.app.data.api.NotificationApi
import com.vxin.app.data.model.DeleteTokenRequest
import com.vxin.app.data.model.DeviceTokenRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * FCM token 注册/注销。登录后注册到后端，登出时注销。
 * 后端用 firebase-admin 凭这些 token 推送新消息。
 */
@Singleton
class PushManager @Inject constructor(
    private val notificationApi: NotificationApi,
    private val tokenStore: TokenStore,
    @AppScope private val scope: CoroutineScope,
) {
    /** 登录/恢复会话后调用：取当前 FCM token 并注册 */
    fun registerCurrentToken() {
        flushPendingGeTuiCid()   // 登录/恢复会话时补注册登录前拿到的个推 CID
        scope.launch {
            Log.i(TAG, "开始获取 FCM token")
            val fcm = fetchToken()
            if (fcm == null) {
                Log.e(TAG, "❌ FCM token 为 null——FCM 未初始化或 Google Play 服务不可用（国产 ROM 无 GMS 属正常，靠个推兜底）")
                return@launch
            }
            Log.i(TAG, "✅ FCM token 获取成功 prefix=${fcm.take(12)}")
            runCatching { notificationApi.registerToken(DeviceTokenRequest(fcm)) }
                .onSuccess { Log.i(TAG, "✅ FCM token 已注册到后端") }
                .onFailure { e -> Log.e(TAG, "❌ token 注册失败 ${e.javaClass.simpleName}: ${e.message}") }
        }
    }

    /** FirebaseMessagingService.onNewToken 回调时调用 */
    fun onNewToken(fcm: String) {
        Log.i(TAG, "onNewToken 收到新 FCM token prefix=${fcm.take(12)}")
        if (!tokenStore.isLoggedIn) { Log.i(TAG, "onNewToken: 未登录，跳过注册"); return }
        scope.launch {
            runCatching { notificationApi.registerToken(DeviceTokenRequest(fcm)) }
                .onSuccess { Log.i(TAG, "✅ 新 token 已注册到后端") }
                .onFailure { e -> Log.e(TAG, "❌ 新 token 注册失败: ${e.message}") }
        }
    }

    /** 个推 CID 注册到后端（platform='getui'）。国产 ROM 无 GMS 时靠这条。 */
    fun registerGeTuiCid(cid: String) {
        Log.i(TAG, "registerGeTuiCid prefix=${cid.take(12)}")
        if (!tokenStore.isLoggedIn) { Log.i(TAG, "个推 CID: 未登录，暂存等登录后注册"); pendingGeTuiCid = cid; return }
        scope.launch {
            runCatching { notificationApi.registerToken(DeviceTokenRequest(cid, platform = "getui")) }
                .onSuccess { Log.i(TAG, "✅ 个推 CID 已注册到后端") }
                .onFailure { e -> Log.e(TAG, "❌ 个推 CID 注册失败: ${e.message}") }
        }
    }

    /** 登录后补注册暂存的个推 CID（CID 可能在登录前就由 SDK 回调拿到）。 */
    private fun flushPendingGeTuiCid() {
        val cid = pendingGeTuiCid ?: return
        pendingGeTuiCid = null
        registerGeTuiCid(cid)
    }

    @Volatile private var pendingGeTuiCid: String? = null

    /** 登出时注销当前 token（best-effort，须在清 auth token 之前调用） */
    suspend fun unregisterCurrentToken() {
        val fcm = fetchToken() ?: return
        runCatching { notificationApi.deleteToken(DeleteTokenRequest(fcm)) }
    }

    private suspend fun fetchToken(): String? = suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { cont.resume(it) }
            .addOnFailureListener { Log.w(TAG, "get FCM token failed: ${it.message}"); cont.resume(null) }
    }

    private companion object { const val TAG = "PushManager" }
}
