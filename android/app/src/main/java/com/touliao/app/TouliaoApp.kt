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
        val diag = StringBuilder()
        runCatching {
            val pm = com.igexin.sdk.PushManager.getInstance()
            // 抓 SDK 内部日志(连接/鉴权/注册错误)到诊断里,定位 CID 为空
            pm.setDebugLogger(applicationContext, object : com.igexin.sdk.IUserLoggerInterface {
                override fun log(s: String?) {
                    android.util.Log.i("GeTuiSDK", s ?: "")
                    if (s != null && s.length < 600) diag.append("SDK: $s\n")
                }
            })
            // 用单参 initialize + 单独 registerPushIntentService（3.2.x 推荐顺序）
            pm.initialize(applicationContext)
            pm.registerPushIntentService(applicationContext, com.touliao.app.core.push.TouliaoGeTuiService::class.java)

            // ── 诊断：读 manifest 实际注入的个推配置（排查 CID 为空的根因）──
            try {
                val ai = applicationContext.packageManager
                    .getApplicationInfo(packageName, android.content.pm.PackageManager.GET_META_DATA)
                val md = ai.metaData
                val appid = md?.getString("GETUI_APPID") ?: "(空!)"
                val appkey = md?.getString("GETUI_APPKEY") ?: "(空!)"
                val appsec = md?.getString("GETUI_APPSECRET") ?: "(空!)"
                diag.append("manifest: APPID=${appid.take(8)}… APPKEY=${appkey.take(6)}… APPSECRET=${appsec.take(6)}…\n")
            } catch (e: Exception) {
                diag.append("读manifest失败: ${e.message}\n")
            }

            // checkManifest：个推官方集成自检（仅 debug 构建生效，无异常=通过）
            try {
                pm.checkManifest(applicationContext)
                diag.append("checkManifest: 通过(无异常)\n")
            } catch (e: Throwable) {
                diag.append("checkManifest异常: ${e.message}\n")
            }
            diag.append("SDK版本: ${pm.getVersion(applicationContext)}\n")

            // 兜底：CID 回调偶发不触发时，延迟主动轮询 getClientid 并上报
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                runCatching {
                    val cid = pm.getClientid(applicationContext)
                    diag.append("初始化后CID: ${if (cid.isNullOrBlank()) "仍为空!!" else cid.take(12) + "…"}\n")
                    if (!cid.isNullOrBlank()) {
                        android.util.Log.i("TouliaoApp", "个推 CID(主动轮询)=${cid.take(12)}…")
                        EntryPointAccessors.fromApplication(this, BridgeEntryPoint::class.java)
                            .pushManager().registerGeTuiCid(cid)
                    } else {
                        android.util.Log.w("TouliaoApp", "个推 CID 仍为空(轮询)，等待回调")
                    }
                    // 发诊断通知（用户可直接看到）
                    android.util.Log.i("TouliaoApp", "个推诊断:\n$diag")
                    showGeTuiDiag(diag.toString())
                    reportGeTuiDiag(diag.toString())
                }
            }, 15000)
        }.onFailure {
            diag.append("初始化失败: ${it.message}\n")
            android.util.Log.w("TouliaoApp", "个推初始化失败(忽略): ${it.message}")
            android.util.Log.i("TouliaoApp", "个推诊断:\n$diag")
            showGeTuiDiag(diag.toString())
            reportGeTuiDiag(diag.toString())
        }
    }

    /** 把个推诊断结果上报后端（服务器日志可见，绕开手机通知权限问题）。 */
    private fun reportGeTuiDiag(text: String) {
        runCatching {
            Thread {
                runCatching {
                    val url = java.net.URL("https://touliao.cc/api/push/getui-diag")
                    val conn = url.openConnection() as java.net.HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setRequestProperty("X-Diag-Token", "diag2026")
                    conn.doOutput = true
                    conn.connectTimeout = 8000
                    conn.readTimeout = 8000
                    val body = "{\"diag\":${org.json.JSONObject.quote(text)}}"
                    conn.outputStream.use { it.write(body.toByteArray()) }
                    android.util.Log.i("TouliaoApp", "诊断上报HTTP ${conn.responseCode}")
                    conn.disconnect()
                }
            }.start()
        }
    }

    /** 把个推诊断结果发成系统通知+弹窗+上报，三重保障真机可见。 */
    private fun showGeTuiDiag(text: String) {
        runCatching {
            val ctx = applicationContext
            // 弹窗：直接在最上层显示（最可靠）
            val intent = android.content.Intent(ctx, com.touliao.app.MainActivity::class.java)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            intent.putExtra("getui_diag_popup", text)
            ctx.startActivity(intent)
        }.onFailure { e -> android.util.Log.e("TouliaoApp", "诊断弹窗失败: ${e.message}") }
        runCatching {
            val ctx = applicationContext
            val nm = ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            val channelId = "getui_diag"
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(
                    android.app.NotificationChannel(channelId, "个推诊断", android.app.NotificationManager.IMPORTANCE_HIGH)
                )
            }
            val intent = android.content.Intent(ctx, com.touliao.app.MainActivity::class.java)
            val pi = android.app.PendingIntent.getActivity(ctx, 0, intent, android.app.PendingIntent.FLAG_IMMUTABLE)
            val notif = android.app.Notification.Builder(ctx, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("个推诊断结果")
                .setContentText(text)
                .setStyle(android.app.Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build()
            nm.notify(9527, notif)
        }.onFailure { e -> android.util.Log.e("TouliaoApp", "诊断通知失败: ${e.message}") }
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
