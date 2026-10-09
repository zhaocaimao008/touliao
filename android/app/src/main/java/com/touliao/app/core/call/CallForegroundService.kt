package com.touliao.app.core.call

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.touliao.app.MainActivity
import com.touliao.app.core.push.NotificationHelper

/**
 * 通话保活前台服务：通话建立本地媒体（开始采集麦克风）后启动，展示一条"通话中"常驻通知，
 * 使进程在熄屏 / Doze 下不被系统回收导致通话中断。
 *
 * - foregroundServiceType：microphone（视频通话再叠加 camera），与 WebRTC 采集对齐（合规要求）。
 * - 生命周期：CallManager / GroupCallManager 建流且 RECORD_AUDIO 已授权后 [start]，cleanup 处 [stop]。
 * - startForeground 失败（权限缺失/后台限制）必须 stopSelf()：startForegroundService 发出后服务若既
 *   不进前台也不停止，系统到时抛 ForegroundServiceDidNotStartInTimeException 直接崩进程。
 * - 不承载信令 / 媒体本身，仅承载前台态；无需 bind。
 * - [running] 只在 startForeground 真正成功后为 true：App 在后台时 startForegroundService/startForeground
 *   会被系统拒绝（Android 12+ 后台启动限制、Android 14 microphone 类型需 while-in-use），调用方据此
 *   在回到前台时补起，否则整通电话在后台都被系统静音麦克风（对方听不见）。
 */
class CallForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
        startAsForeground(video)
        // 被系统杀掉不自动重建（通话已断，重建无意义）
        return START_NOT_STICKY
    }

    private fun startAsForeground(video: Boolean) {
        val tap = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                action = NotificationHelper.ACTION_CALL_SHOW
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(this, NotificationHelper.CALL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("通话中")
            .setContentText(if (video) "视频通话进行中" else "语音通话进行中")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(tap)
            .build()

        // API 34+(U) 必须显式传 foregroundServiceType；用 ServiceCompat 兼容旧版本。
        // camera 类型只在已授权 CAMERA 时叠加（Android 14 未授权叠加会抛 SecurityException）
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (video && hasPermission(this, android.Manifest.permission.CAMERA)) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            t
        } else {
            0
        }
        runCatching {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
            running = true
        }.onFailure { e ->
            android.util.Log.w("CallForegroundService", "startForeground 失败，停止服务: ${e.message}")
            running = false
            stopSelf()
        }
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 424243   // 与来电通知(424242)分开
        private const val EXTRA_VIDEO = "video"

        /** 服务是否已真正进入前台（startForeground 成功）；被拒/已停为 false。 */
        @Volatile @JvmStatic var running: Boolean = false
            private set

        private fun hasPermission(context: Context, permission: String): Boolean =
            ContextCompat.checkSelfPermission(context, permission) == android.content.pm.PackageManager.PERMISSION_GRANTED

        /** microphone 类型 FGS 的前提：RECORD_AUDIO 已授权。 */
        fun hasRecordAudioPermission(context: Context): Boolean =
            hasPermission(context, android.Manifest.permission.RECORD_AUDIO)

        /**
         * RECORD_AUDIO 已授权后调用（未授权直接跳过，由调用方授权后再调）。
         * 返回请求是否发出：后台被拒（ForegroundServiceStartNotAllowedException 等）返回 false。
         * 发出后 startForeground 仍可能在服务内失败，以 [running] 为准。
         */
        fun start(context: Context, video: Boolean): Boolean {
            if (!hasRecordAudioPermission(context)) return false
            val intent = Intent(context, CallForegroundService::class.java).putExtra(EXTRA_VIDEO, video)
            return runCatching { ContextCompat.startForegroundService(context, intent) }
                .onFailure { e -> android.util.Log.w("CallForegroundService", "startForegroundService 被拒: ${e.message}") }
                .isSuccess
        }

        /** 通话结束（cleanup）时调用。 */
        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallForegroundService::class.java)) }
        }
    }
}
