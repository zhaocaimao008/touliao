package com.vxin.app.core.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.vxin.app.MainActivity
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 通知渠道 + 展示。渠道 id 与后端 FCM android.notification.channelId 一致（vxin_messages）。
 */
@Singleton
class NotificationHelper @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    init { createChannel() }

    fun showMessageNotification(title: String, body: String, conversationId: String?) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            conversationId?.let { putExtra(EXTRA_CONVERSATION_ID, it) }
        }
        val pending = PendingIntent.getActivity(
            context, conversationId?.hashCode() ?: 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pending)
            .build()

        // Android 13+ 无 POST_NOTIFICATIONS 权限时 notify 会被忽略（不抛异常）
        try {
            NotificationManagerCompat.from(context).notify(
                conversationId?.hashCode() ?: System.currentTimeMillis().toInt(),
                notification,
            )
        } catch (_: SecurityException) { /* 无权限，忽略 */ }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            val messages = NotificationChannel(
                CHANNEL_ID, "消息通知", NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = "新消息与提及" }
            mgr.createNotificationChannel(messages)
            // 来电渠道：最高优先级 + 绕过勿扰，为后续 fullScreenIntent 来电通知预留（拉起 CallScreen）。
            val calls = NotificationChannel(
                CALL_CHANNEL_ID, "来电", NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "语音/视频通话来电"
                setBypassDnd(true)
                enableVibration(true)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            mgr.createNotificationChannel(calls)
        }
    }

    companion object {
        const val CHANNEL_ID = "vxin_messages"
        const val CALL_CHANNEL_ID = "vxin_calls"
        const val EXTRA_CONVERSATION_ID = "conversationId"
    }
}
