package com.vxin.app.core.call

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
import com.vxin.app.MainActivity
import com.vxin.app.core.push.NotificationHelper

/**
 * 通话保活前台服务：通话建立本地媒体（开始采集麦克风）后启动，展示一条"通话中"常驻通知，
 * 使进程在熄屏 / Doze 下不被系统回收导致通话中断。
 *
 * - foregroundServiceType：microphone（视频通话再叠加 camera），与 WebRTC 采集对齐（合规要求）。
 * - 生命周期：CallManager 在 startCall/accept 建流处 [start]，cleanup 处 [stop]。
 * - 不承载信令 / 媒体本身，仅承载前台态；无需 bind。
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
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (video) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            t
        } else {
            0
        }
        runCatching {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        }
    }

    companion object {
        private const val NOTIFICATION_ID = 424243   // 与来电通知(424242)分开
        private const val EXTRA_VIDEO = "video"

        /** 通话建立本地媒体后调用（此刻 App 在前台、RECORD_AUDIO 已授予，满足 microphone FGS 合规）。 */
        fun start(context: Context, video: Boolean) {
            val intent = Intent(context, CallForegroundService::class.java).putExtra(EXTRA_VIDEO, video)
            runCatching { ContextCompat.startForegroundService(context, intent) }
        }

        /** 通话结束（cleanup）时调用。 */
        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallForegroundService::class.java)) }
        }
    }
}
