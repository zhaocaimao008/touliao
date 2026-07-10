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
 * 通知渠道 + 展示。渠道 id 与后端 FCM android.notification.channelId 一致（vxin_messages_v2）。
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
            // MESSAGE 类别 + 声音/震动/呼吸灯：Android 7 及以下靠此决定 heads-up 弹出与提醒
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            // 锁屏完整展示标题与内容（PRIVATE 只显示"有新通知"，会导致锁屏看不到提醒内容）
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
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

    /**
     * 来电通知：全屏意图 + 接听/拒绝。App 在后台/锁屏时由系统直接拉起来电界面。
     * data 来自后端 data-only FCM（type=call）。点击/接听/拒绝均拉起 MainActivity 并带 extra，
     * 由 MainActivity 交给 CallManager 进入 INCOMING（accept 时并置接听意图）。
     */
    fun showCallNotification(callId: String, from: String, callerName: String, callType: String) {
        fun callIntent(action: String) = Intent(context, MainActivity::class.java).apply {
            this.action = action
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_CALL_ID, callId)
            putExtra(EXTRA_CALL_FROM, from)
            putExtra(EXTRA_CALL_NAME, callerName)
            putExtra(EXTRA_CALL_TYPE, callType)
        }
        val reqBase = from.hashCode()
        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val fullScreen = PendingIntent.getActivity(context, reqBase, callIntent(ACTION_CALL_SHOW), piFlags)
        val accept = PendingIntent.getActivity(context, reqBase + 1, callIntent(ACTION_CALL_ACCEPT), piFlags)
        val decline = PendingIntent.getActivity(context, reqBase + 2, callIntent(ACTION_CALL_DECLINE), piFlags)

        val title = callerName.ifBlank { "来电" }
        val text = if (callType == "video") "邀请你视频通话" else "邀请你语音通话"
        val notification = NotificationCompat.Builder(context, CALL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            .addAction(android.R.drawable.ic_menu_call, "接听", accept)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "拒绝", decline)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(CALL_NOTIFICATION_ID, notification)
        } catch (_: SecurityException) { /* 无权限，忽略 */ }
    }

    /** 接听/拒绝后清除来电通知 */
    fun cancelCallNotification() {
        NotificationManagerCompat.from(context).cancel(CALL_NOTIFICATION_ID)
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = context.getSystemService(NotificationManager::class.java) ?: return
            val messages = NotificationChannel(
                CHANNEL_ID, "消息通知", NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "新消息与提及"
                // 锁屏可见性：Android 8+ 由渠道决定。PUBLIC = 锁屏完整显示内容，
                // 否则锁屏收到消息时用户看不到任何提醒（本次问题根因之一）。
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                enableVibration(true)
                enableLights(true)
            }
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
        // 渠道 id 带版本后缀：已存在渠道无法改锁屏可见性/震动（Android 保护用户既有设置），
        // 需换新 id 才能让新配置对老用户生效。改动这些渠道属性时同步 bump 版本号。
        // 注意：后端 FCM android.notification.channelId 也须同步为此值（见 backend push.js）。
        const val CHANNEL_ID = "vxin_messages_v2"
        const val CALL_CHANNEL_ID = "vxin_calls"
        const val EXTRA_CONVERSATION_ID = "conversationId"
        const val CALL_NOTIFICATION_ID = 424242

        // 来电通知 Intent action / extra（MainActivity 据此进入 INCOMING）
        const val ACTION_CALL_SHOW = "com.vxin.app.action.CALL_SHOW"
        const val ACTION_CALL_ACCEPT = "com.vxin.app.action.CALL_ACCEPT"
        const val ACTION_CALL_DECLINE = "com.vxin.app.action.CALL_DECLINE"
        const val EXTRA_CALL_ID = "callId"
        const val EXTRA_CALL_FROM = "callFrom"
        const val EXTRA_CALL_NAME = "callerName"
        const val EXTRA_CALL_TYPE = "callType"
    }
}
