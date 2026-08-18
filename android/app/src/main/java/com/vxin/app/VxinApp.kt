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
class VxinApp : Application(), ImageLoaderFactory {

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
        initGeTui()
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
                android.util.Log.i("VxinApp", "GMS 可用，FCM 自动注册已启用")
            } else {
                android.util.Log.i("VxinApp", "GMS 不可用(result=$result)，跳过 FCM 初始化，推送走个推")
            }
        }.onFailure {
            android.util.Log.w("VxinApp", "Firebase init skipped: ${it.message}")
        }
    }

    /** 初始化个推 SDK（异常不阻断启动；未配置 AppID 时 SDK 自身会 no-op）。 */
    private fun initGeTui() {
        runCatching {
            val pm = com.igexin.sdk.PushManager.getInstance()
            // 用单参 initialize + 单独 registerPushIntentService（3.2.x 推荐顺序）
            pm.initialize(applicationContext)
            pm.registerPushIntentService(applicationContext, com.touliao.app.core.push.VxinGeTuiService::class.java)
            // 兜底：CID 回调偶发不触发时，延迟主动轮询 getClientid 并上报
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                runCatching {
                    val cid = pm.getClientid(applicationContext)
                    if (!cid.isNullOrBlank()) {
                        android.util.Log.i("VxinApp", "个推 CID(主动轮询)=${cid.take(12)}…")
                        EntryPointAccessors.fromApplication(this, BridgeEntryPoint::class.java)
                            .pushManager().registerGeTuiCid(cid)
                    } else {
                        android.util.Log.w("VxinApp", "个推 CID 仍为空(轮询)，等待回调")
                    }
                }
            }, 8000)
        }.onFailure {
            android.util.Log.w("VxinApp", "个推初始化失败(忽略): ${it.message}")
        }
    }

    /**
     * 自定义 Coil ImageLoader：
     * 1) 稳定磁盘缓存键——/uploads 受保护资源的地址带 ?token=<JWT>，而 Coil 默认以
     *    完整 URL 作缓存键。JWT 轮换(刷新/重登)后所有图片键失效→头像/图片全部重新
     *    下载。这里剥掉 query 只用路径作 diskCacheKey，令已下载的原始字节跨 token 轮换
     *    存活，避免重复下载（真正的观感/流量杀手）；真正请求仍走带 token 的原地址
     *    （data 不变），鉴权不受影响。
     *    ⚠ 只稳定 diskCacheKey、不动 memoryCacheKey：内存键仍含尺寸信息，避免同一图
     *    在不同尺寸(气泡缩略图 vs 全屏大图)命中同一 bitmap 而糊掉；内存未命中时从磁盘
     *    按当前尺寸重新解码，无网络开销、且清晰。
     * 2) crossfade 淡入，加载观感更顺滑。
     */
    override fun newImageLoader(): ImageLoader =
        ImageLoader.Builder(this)
            .crossfade(true)
            .components {
                add(object : Interceptor {
                    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
                        val req = chain.request
                        val data = req.data
                        if (data is String && data.contains("token=")) {
                            val stableKey = data.substringBefore("?")
                            return chain.proceed(
                                req.newBuilder()
                                    .diskCacheKey(stableKey)
                                    .build()
                            )
                        }
                        return chain.proceed(req)
                    }
                })
            }
            .build()
}
