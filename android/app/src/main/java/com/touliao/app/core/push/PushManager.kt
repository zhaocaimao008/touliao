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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
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
    @ApplicationContext private val context: Context,
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

    /**
     * 登出/切号时注销当前账号在本机的所有 push token（best-effort，须在清 auth token 之前调用）。
     * FCM 和个推 CID 都要删——只删 FCM 会在无 GMS 的国产 ROM 设备上把个推 CID 原样留在后端，
     * 导致切号/登出后旧账号的消息仍然按 device_tokens 里残留的这条记录推送到本机（见 AUDIT.md 十四节"串号推送"）。
     */
    suspend fun unregisterCurrentToken() {
        fetchToken()?.let { fcm -> runCatching { notificationApi.deleteToken(DeleteTokenRequest(fcm)) } }
        fetchGeTuiCid()?.let { cid -> runCatching { notificationApi.deleteToken(DeleteTokenRequest(cid)) } }
    }

    /** 同步读取个推 SDK 当前缓存的 CID（未初始化/无 GMS 场景可能返回 null 或空串）。 */
    private fun fetchGeTuiCid(): String? =
        runCatching { com.igexin.sdk.PushManager.getInstance().getClientid(context) }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }

    /**
     * 获取 FCM token，最多等待 5 秒。
     * 国产 ROM 无 GMS 时 FirebaseMessaging.token 的 Task 两个回调都不触发，
     * 若不设超时会导致 suspend 函数永久挂起 → logout() 协程卡死 → 退出按钮无反应。
     * 超时返回 null，调用方按 null 处理（unregisterCurrentToken 直接 return，不影响后续流程）。
     * 华为/无 GMS 机型补充：FirebaseMessaging.getInstance() 本身可能抛 RuntimeException
     * （Firebase 初始化链失败），runCatching 兜底防止 App 崩溃。
     */
    private suspend fun fetchToken(): String? = withTimeoutOrNull(5_000) {
        runCatching {
            suspendCancellableCoroutine<String?> { cont ->
                FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { cont.resume(it) }
                    .addOnFailureListener { e ->
                        Log.w(TAG, "get FCM token failed: ${e.message}")
                        cont.resume(null)
                    }
            }
        }.onFailure { e ->
            Log.w(TAG, "FirebaseMessaging unavailable (no GMS?): ${e.javaClass.simpleName}: ${e.message}")
        }.getOrNull()
    }

    private companion object { const val TAG = "PushManager" }
}
