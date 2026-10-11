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
import com.touliao.app.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Account-scoped message aggregation, preference channels and read cleanup. */
@Singleton
class NotificationHelper @Inject constructor(
    @ApplicationContext private val context: Context,
    private val accountStore: com.touliao.app.core.storage.AccountStore,
    private val tokenStore: com.touliao.app.core.storage.TokenStore,
) {
    init { createChannel() }

    private val seen = context.getSharedPreferences("push_seen_messages", Context.MODE_PRIVATE)
    private data class PendingCard(val lines: List<String>, val count: Int, val postedAt: Long)
    private val pendingCards = mutableMapOf<String, PendingCard>()

    fun acceptsRecipient(recipientId: String?) = PushRecipient.matches(recipientId, accountStore.activeId(), tokenStore.isLoggedIn)

    @Synchronized
    fun clearAccountNotifications() {
        seen.edit().clear().apply()
        pendingCards.clear()
        NotificationManagerCompat.from(context).cancelAll()
        com.touliao.app.navigation.PendingConversationHolder.conversationId.value = null
    }

    @Synchronized
    fun showMessageNotification(title: String, body: String, conversationId: String?, unreadCount: Int? = null,
        recipientId: String? = accountStore.activeId(), messageId: String? = null,
        sound: Boolean = true, vibrate: Boolean = false, detailPreview: Boolean = true) {
        if (!acceptsRecipient(recipientId)) return
        val recipient = recipientId ?: return
        val convId = conversationId?.takeIf { it.isNotBlank() } ?: "global"
        val tag = NotificationPolicy.tag(recipient, convId)
        val recent = seen.getString("ids:$recipient", "").orEmpty().split('\n').filter { it.isNotEmpty() }.toMutableList()
        val identity = messageId?.takeIf { it.isNotBlank() }?.let { "$convId:$it" }
        if (identity != null && identity in recent) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val previous = manager.activeNotifications.firstOrNull { it.tag == tag && it.id == MESSAGE_NOTIFICATION_ID }?.notification
        // notify() is queued by Android: the just-posted card may not yet be in activeNotifications.
        val cached = pendingCards[tag]?.takeIf { previous != null || android.os.SystemClock.elapsedRealtime() - it.postedAt < 2000 }
        val lines = if (detailPreview) (cached?.lines ?: previous?.extras?.getCharSequenceArray(android.app.Notification.EXTRA_TEXT_LINES)?.map { it.toString() }).orEmpty().toMutableList() else mutableListOf()
        lines.add(0, body)
        val count = unreadCount?.coerceAtLeast(0) ?: ((cached?.count ?: previous?.number ?: 0) + 1)
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            conversationId?.let { putExtra(EXTRA_CONVERSATION_ID, it) }
            putExtra(EXTRA_RECIPIENT_ID, recipient)
            data = android.net.Uri.Builder().scheme("touliao").authority("notification").appendPath(recipient).appendPath(convId).build()
        }
        val pending = PendingIntent.getActivity(context, tag.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val publicVersion = NotificationCompat.Builder(context, NotificationPolicy.channel(sound, vibrate))
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("投聊").setContentText("收到新消息").build()
        val builder = NotificationCompat.Builder(context, NotificationPolicy.channel(sound, vibrate))
            .setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(body)
            .setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setDefaults((if (sound) NotificationCompat.DEFAULT_SOUND else 0) or (if (vibrate) NotificationCompat.DEFAULT_VIBRATE else 0))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(publicVersion)
            .setContentIntent(pending).setNumber(count)
            .setGroup(GROUP_KEY_MESSAGES).setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        val style = NotificationCompat.InboxStyle().setBigContentTitle(title).setSummaryText("$count 条新消息")
        lines.take(5).forEach { style.addLine(it) }
        builder.setStyle(style)
        if (!acceptsRecipient(recipient)) return
        try {
            val mgr = NotificationManagerCompat.from(context)
            mgr.notify(tag, MESSAGE_NOTIFICATION_ID, builder.build())
            pendingCards[tag] = PendingCard(lines.take(5), count, android.os.SystemClock.elapsedRealtime())
            if (identity != null) {
                recent.add(identity)
                seen.edit().putString("ids:$recipient", recent.takeLast(128).joinToString("\n")).apply()
            }
            showGroupSummary(mgr)
        } catch (_: SecurityException) { /* Permission may be revoked while delivering. */ }
    }

    @Synchronized
    fun clearConversationNotifications(conversationId: String) {
        val recipient = accountStore.activeId() ?: return
        val mgr = NotificationManagerCompat.from(context)
        pendingCards.remove(NotificationPolicy.tag(recipient, conversationId))
        mgr.cancel(NotificationPolicy.tag(recipient, conversationId), MESSAGE_NOTIFICATION_ID)
        mgr.cancel(conversationId, 1000) // notifications created by previous releases
        mgr.cancel(NotificationPolicy.vendorId(recipient, conversationId))
        showGroupSummary(mgr, NotificationPolicy.tag(recipient, conversationId))
    }

    private fun showGroupSummary(mgr: NotificationManagerCompat, removedTag: String? = null) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val cards = manager.activeNotifications.filter { it.tag != removedTag && it.id == MESSAGE_NOTIFICATION_ID && it.notification.group == GROUP_KEY_MESSAGES }
        val counts = cards.associate { it.tag to it.notification.number.coerceAtLeast(1) }.toMutableMap()
        val now = android.os.SystemClock.elapsedRealtime()
        pendingCards.entries.removeAll { it.key !in counts && now - it.value.postedAt >= 2000 }
        pendingCards.forEach { (tag, card) -> counts[tag] = card.count }
        if (counts.size < 2) { mgr.cancel(SUMMARY_NOTIFICATION_ID); return }
        val total = counts.values.sum()
        val summary = NotificationCompat.Builder(context, NotificationPolicy.channel(false, false))
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("投聊").setContentText("$total 条新消息")
            .setGroup(GROUP_KEY_MESSAGES).setGroupSummary(true).setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setSilent(true).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        try { mgr.notify(SUMMARY_NOTIFICATION_ID, summary) } catch (_: SecurityException) {}
    }

    /**
     * 来电通知：全屏意图 + 接听/拒绝。App 在后台/锁屏时由系统直接拉起来电界面。
     * data 来自后端 data-only FCM（type=call）。点击/接听/拒绝均拉起 MainActivity 并带 extra，
     * 由 MainActivity 交给 CallManager 进入 INCOMING（accept 时并置接听意图）。
     */
    fun showCallNotification(callId: String, from: String, callerName: String, callType: String, recipientId: String? = accountStore.activeId()) {
        if (!acceptsRecipient(recipientId)) return
        fun callIntent(action: String) = Intent(context, MainActivity::class.java).apply {
            this.action = action
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_CALL_ID, callId)
            putExtra(EXTRA_CALL_FROM, from)
            putExtra(EXTRA_CALL_NAME, callerName)
            putExtra(EXTRA_CALL_TYPE, callType)
            putExtra(EXTRA_RECIPIENT_ID, recipientId)
            data = android.net.Uri.Builder().scheme("touliao").authority("call").appendPath(recipientId).appendPath(callId).build()
        }
        val reqBase = from.hashCode()
        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val fullScreen = PendingIntent.getActivity(context, reqBase, callIntent(ACTION_CALL_SHOW), piFlags)
        val accept = PendingIntent.getActivity(context, reqBase + 1, callIntent(ACTION_CALL_ACCEPT), piFlags)
        val decline = PendingIntent.getActivity(context, reqBase + 2, callIntent(ACTION_CALL_DECLINE), piFlags)

        val title = callerName.ifBlank { "来电" }
        val text = if (callType == "video") "邀请你视频通话" else "邀请你语音通话"
        val notification = NotificationCompat.Builder(context, CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
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
                // Legacy baseline only; new preference channels use PRIVATE visibility.
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                enableVibration(true)
                enableLights(true)
            }
            mgr.createNotificationChannel(messages)
            // Inherit existing system controls. Never delete/recreate channels to reset a user's choice.
            val legacy = mgr.getNotificationChannel(CHANNEL_ID)
            for (sound in listOf(false, true)) for (vibrate in listOf(false, true)) {
                val id = NotificationPolicy.channel(sound, vibrate)
                if (mgr.getNotificationChannel(id) != null) continue
                val label = when { sound && vibrate -> "消息 · 声音与振动"; sound -> "消息 · 声音"; vibrate -> "消息 · 振动"; else -> "消息 · 静音" }
                val channel = NotificationChannel(id, label, legacy?.importance ?: NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "遵循投聊通知设置及系统通知设置"
                    lockscreenVisibility = if (legacy?.lockscreenVisibility == android.app.Notification.VISIBILITY_SECRET) android.app.Notification.VISIBILITY_SECRET else android.app.Notification.VISIBILITY_PRIVATE
                    setSound(if (sound) legacy?.sound else null, legacy?.audioAttributes)
                    enableVibration(vibrate && legacy?.shouldVibrate() != false)
                    setShowBadge(legacy?.canShowBadge() != false)
                }
                mgr.createNotificationChannel(channel)
            }
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
        // Preserve the legacy channel as the migration baseline for user controls.
        const val CHANNEL_ID = "vxin_messages_v3"
        const val CALL_CHANNEL_ID = "vxin_calls"
        const val EXTRA_CONVERSATION_ID = "conversationId"
        const val EXTRA_RECIPIENT_ID = "recipientId"
        // Firebase's OS-displayed notification uses id=0 with the same account/chat tag.
        const val MESSAGE_NOTIFICATION_ID = 0
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
