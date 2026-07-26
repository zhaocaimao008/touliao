package com.vxin.app

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
        fun messageNotificationBridge(): com.vxin.app.core.push.MessageNotificationBridge
        fun notificationHelper(): com.vxin.app.core.push.NotificationHelper
    }

    override fun onCreate() {
        super.onCreate()
        // 启动即把持久化的外观偏好同步进全局主题流，保证首帧就是用户选择的主题（同步、无 DI、异常兜底）。
        com.vxin.app.core.storage.ThemeStore.syncInitial(this)
        val entry = EntryPointAccessors.fromApplication(this, BridgeEntryPoint::class.java)
        // 启动即创建通知渠道：确保 App 被杀死后 FCM 到达时渠道已存在，否则 Android 8+
        // 因找不到 channelId 静默丢弃锁屏通知（安卓锁屏收不到通知的根因之一）。
        entry.notificationHelper()
        // 后台/锁屏时 socket 消息补本地通知（服务端判在线不发 FCM 的场景②）。
        entry.messageNotificationBridge().install(this)
        // 初始化个推 SDK（国产 ROM 无 GMS 时的推送兜底）。仅当已配置 AppID 时启动，
        // CID 由 VxinGeTuiService.onReceiveClientId 回调 → 上报后端。
        initGeTui()
    }

    /** 初始化个推 SDK（异常不阻断启动；未配置 AppID 时 SDK 自身会 no-op）。 */
    private fun initGeTui() {
        runCatching {
            com.igexin.sdk.PushManager.getInstance().initialize(applicationContext)
            com.igexin.sdk.PushManager.getInstance().registerPushIntentService(
                applicationContext,
                com.vxin.app.core.push.VxinGeTuiService::class.java,
            )
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
