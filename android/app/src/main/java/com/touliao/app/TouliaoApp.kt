package com.touliao.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.intercept.Interceptor
import coil.request.ImageResult
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.HiltAndroidApp
import dagger.hilt.components.SingletonComponent

@HiltAndroidApp
class TouliaoApp : Application(), ImageLoaderFactory {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface BridgeEntryPoint {
        fun messageNotificationBridge(): com.touliao.app.core.push.MessageNotificationBridge
        fun notificationHelper(): com.touliao.app.core.push.NotificationHelper
        fun pushManager(): com.touliao.app.core.push.PushManager
    }

    override fun attachBaseContext(base: android.content.Context) {
        super.attachBaseContext(base)
        // DEVICE-P1-001: 最早安全入口注册崩溃记录器（不吞 crash，仅落盘脱敏诊断）
        com.touliao.app.core.crash.StartupCrashRecorder.install(this)
    }

    override fun onCreate() {
        super.onCreate()
        com.touliao.app.core.storage.ThemeStore.syncInitial(this)
        val entry = EntryPointAccessors.fromApplication(this, BridgeEntryPoint::class.java)
        entry.notificationHelper()
        entry.messageNotificationBridge().install(this)
        // 有 GMS 时手动启用 FCM 自动注册（Manifest 已关闭自动初始化防华为崩溃）
        initFirebaseIfGmsAvailable()
        // 个推 SDK 要求 initialize 只在主进程调用（非主进程会抛 Must be called in main process）。
        // Application.onCreate 会在每个进程执行（含个推自己的 :pushservice 进程），必须过滤。
        if (isMainProcess()) initGeTui()
    }

    /** 判断当前是否主进程（个推 initialize 强制要求主进程）。 */
    private fun isMainProcess(): Boolean {
        val am = getSystemService(android.content.Context.ACTIVITY_SERVICE) as? android.app.ActivityManager ?: return true
        val pid = android.os.Process.myPid()
        val myName = am.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName
        return myName == null || myName == packageName
    }

    /**
     * 仅在 Google Play Services 可用时启用 FCM token 注册。
     * 无 GMS 华为机：跳过，推送由个推 GeTui 兜底。
     * 禁用 firebase_messaging_auto_init_enabled 后，需手动调用 setAutoInitEnabled(true)
     * 才会触发 onNewToken 回调并向后端注册 token。
     */
    private fun initFirebaseIfGmsAvailable() {
        runCatching {
            val result = com.google.android.gms.common.GoogleApiAvailability.getInstance()
                .isGooglePlayServicesAvailable(this)
            if (result == com.google.android.gms.common.ConnectionResult.SUCCESS) {
                com.google.firebase.messaging.FirebaseMessaging.getInstance()
                    .isAutoInitEnabled = true
                android.util.Log.i("TouliaoApp", "GMS 可用，FCM 自动注册已启用")
            } else {
                android.util.Log.i("TouliaoApp", "GMS 不可用(result=$result)，跳过 FCM 初始化，推送走个推")
            }
        }.onFailure {
            android.util.Log.w("TouliaoApp", "Firebase init skipped: ${it.message}")
        }
    }

    /** 初始化个推 SDK（异常不阻断启动；未配置 AppID 时 SDK 自身会 no-op）。 */
    private fun initGeTui() {
        runCatching {
            val pm = com.igexin.sdk.PushManager.getInstance()
            // 用单参 initialize + 单独 registerPushIntentService（3.2.x 推荐顺序）
            pm.initialize(applicationContext)
            pm.registerPushIntentService(applicationContext, com.touliao.app.core.push.TouliaoGeTuiService::class.java)

            // 兜底：CID 回调偶发不触发时，延迟主动轮询 getClientid 并上报
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                runCatching {
                    val cid = pm.getClientid(applicationContext)
                    if (!cid.isNullOrBlank()) {
                        android.util.Log.i("TouliaoApp", "个推 CID(主动轮询)=${cid.take(12)}…")
                        EntryPointAccessors.fromApplication(this, BridgeEntryPoint::class.java)
                            .pushManager().registerGeTuiCid(cid)
                    } else {
                        android.util.Log.w("TouliaoApp", "个推 CID 仍为空(轮询)，等待回调")
                    }
                }
            }, 15000)
        }.onFailure {
            android.util.Log.w("TouliaoApp", "个推初始化失败(忽略): ${it.message}")
        }
    }

    /** Same-origin Bearer requests; cache keys include account identity and contain no token. */
    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .crossfade(true)
            .okHttpClient(com.touliao.app.core.util.downloadHttpClient(this))
            .components {
                add(object : Interceptor {
                    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
                        val req = chain.request
                        val data = req.data
                        if (data is String) {
                            val entry = dagger.hilt.android.EntryPointAccessors.fromApplication(this@TouliaoApp, com.touliao.app.core.util.DownloadClientEntryPoint::class.java)
                            val credentials = entry.tokenStore()
                            val owner = credentials.snapshot()
                            var account = ""
                            if (!credentials.withCurrent(owner) { account = entry.accountStore().activeId().orEmpty() }) throw java.io.IOException("媒体所属账号已切换")
                            val key = account + ":" + data.substringBefore("?")
                            val builder = req.newBuilder().diskCacheKey(key)
                                .setParameter("touliao.account", account, account)
                            owner.token?.let { builder.addHeader("Authorization", "Bearer $it") }
                            val result = chain.proceed(builder.build())
                            if (!credentials.isCurrent(owner)) throw java.io.IOException("媒体所属账号已切换")
                            return result
                        }
                        return chain.proceed(req)
                    }
                })
            }
            .build()
}
