package com.touliao.app.core.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.touliao.app.MainActivity
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 通知渠道 + 展示。渠道 id 与后端 FCM android.notification.channelId 一致（vxin_messages_v3）。
 *
 * 通知聚合：同一会话短时间内多条消息折叠为 InboxStyle（最多显示 5 条预览 + 未读总数），
 * 并用 Android 7+ NotificationGroup 汇总，避免同会话连发多条互相覆盖只留最后一条。
 */
@Singleton
class NotificationHelper @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    init { createChannel() }

    // convId -> 累计未读消息摘要列表（最新在前，最多保留 5 条）。
    // ArrayDeque 本身非线程安全，复合操作（addFirst/removeLast/size 判断/遍历）一律在
    // synchronized(lines) 内完成，防止并发消息到达时互相打断导致丢行/状态错乱/CME。
    private val pendingLines = ConcurrentHashMap<String, ArrayDeque<String>>()

    fun showMessageNotification(title: String, body: String, conversationId: String?, unreadCount: Int? = null) {
        val convId = conversationId ?: "global"
        val lines = pendingLines.getOrPut(convId) { ArrayDeque() }

        // 聚合摘要列表 + 出通知：整段读-改-notify 序列在同一把（每会话独立的）锁内完成，
        // 保证并发到达的消息严格按处理顺序落进通知（不会出现旧快照 notify 覆盖新快照）。
        synchronized(lines) {
            lines.addFirst(body)
            if (lines.size > 5) lines.removeLast()

            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                conversationId?.let { putExtra(EXTRA_CONVERSATION_ID, it) }
            }
            // requestCode 仅用于区分 PendingIntent 身份（不同会话点击后带不同 extra），
            // 与下面 notify() 的 tray 身份无关，取 convId.hashCode() 足够。
            val pending = PendingIntent.getActivity(
                context, convId.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
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
                // ── 通知分组（Android 7+）──────────────────────────
                .setGroup(GROUP_KEY_MESSAGES)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)

            // 角标数字：优先用后端真实未读数（FCM data.badge，SQL COUNT>last_read_at），
            // 本地聚合列表最多只缓存 5 条，不能代表真实未读；没有 badge 时（如个推透传兜底）
            // 退回本地聚合条数估算。
            val badgeCount = unreadCount?.takeIf { it > 0 } ?: lines.size
            if (badgeCount > 0) builder.setNumber(badgeCount)

            // 多条消息时展开 InboxStyle（折叠展示多行摘要）
            if (lines.size > 1) {
                val style = NotificationCompat.InboxStyle()
                    .setBigContentTitle(title)
                    .setSummaryText("$badgeCount 条新消息")
                lines.forEach { style.addLine(it) }
                builder.setStyle(style)
            }

            // Android 13+ 无 POST_NOTIFICATIONS 权限时 notify 会被忽略（不抛异常）
            // tag=convId + 固定 id：通知 tray 身份不再依赖进程内计数器，跨进程重启也不会
            // 因为 id 复位而让新会话覆盖/顶掉另一个仍在展示的会话通知。
            try {
                val mgr = NotificationManagerCompat.from(context)
                mgr.notify(convId, MESSAGE_NOTIFICATION_ID, builder.build())
                // 更新群组汇总通知（Android 7+ 折叠多会话）
                showGroupSummary(mgr)
            } catch (_: SecurityException) { /* 无权限，忽略 */ }
        }
    }

    /** 清除某会话的聚合缓存（进入聊天时调用） */
    fun clearConversationNotifications(conversationId: String) {
        pendingLines.remove(conversationId)
        NotificationManagerCompat.from(context).cancel(conversationId, MESSAGE_NOTIFICATION_ID)
    }

    /** 群组汇总通知（Android 7+ 多通知折叠）*/
    private fun showGroupSummary(mgr: NotificationManagerCompat) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val totalUnread = pendingLines.values.sumOf { synchronized(it) { it.size } }
        if (totalUnread < 2) return   // 只有 1 条时不显示汇总
        val summary = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("投聊")
            .setContentText("${totalUnread} 条新消息")
            .setGroup(GROUP_KEY_MESSAGES)
            .setGroupSummary(true)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
        try { mgr.notify(SUMMARY_NOTIFICATION_ID, summary) } catch (_: SecurityException) {}
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
        const val CHANNEL_ID = "vxin_messages_v3"
        const val CALL_CHANNEL_ID = "vxin_calls"
        const val EXTRA_CONVERSATION_ID = "conversationId"
        // 消息通知固定 id：配合 notify(tag=convId, id=...) 使用，身份由 tag 区分，
        // 不依赖进程内计数器，跨进程重启保持稳定（见 F4 修复说明）。
        const val MESSAGE_NOTIFICATION_ID = 1000
        const val CALL_NOTIFICATION_ID = 424242
        const val SUMMARY_NOTIFICATION_ID = 424200        // 群组汇总通知 ID（固定，更新时覆盖）
        const val GROUP_KEY_MESSAGES = "com.touliao.app.MESSAGES"   // 消息通知分组键

        // 来电通知 Intent action / extra（MainActivity 据此进入 INCOMING）
        const val ACTION_CALL_SHOW = "com.touliao.app.action.CALL_SHOW"
        const val ACTION_CALL_ACCEPT = "com.touliao.app.action.CALL_ACCEPT"
        const val ACTION_CALL_DECLINE = "com.touliao.app.action.CALL_DECLINE"
        const val EXTRA_CALL_ID = "callId"
        const val EXTRA_CALL_FROM = "callFrom"
        const val EXTRA_CALL_NAME = "callerName"
        const val EXTRA_CALL_TYPE = "callType"
    }
}
