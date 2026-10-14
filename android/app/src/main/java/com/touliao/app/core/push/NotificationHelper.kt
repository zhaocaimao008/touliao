package com.touliao.app.core.push

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.touliao.app.MainActivity
import com.touliao.app.R
import com.touliao.app.core.call.CallIntents
import com.touliao.app.core.call.GroupCallInvite
import com.touliao.app.feature.call.CallActivity
import com.touliao.app.feature.call.CallPermissions
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
        showGroupSummary(mgr, setOf(NotificationPolicy.tag(recipient, conversationId), conversationId))
    }

    private fun showGroupSummary(mgr: NotificationManagerCompat, removedTags: Set<String> = emptySet()) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val active = manager.activeNotifications
        val cards = active.filter { it.tag !in removedTags && it.id != SUMMARY_NOTIFICATION_ID && it.notification.group == GROUP_KEY_MESSAGES }
        val counts = cards.associate { it.tag to it.notification.number.coerceAtLeast(1) }.toMutableMap()
        val now = android.os.SystemClock.elapsedRealtime()
        pendingCards.entries.removeAll { it.key !in counts && now - it.value.postedAt >= 2000 }
        pendingCards.forEach { (tag, card) -> counts[tag] = card.count }
        if (counts.isEmpty()) { mgr.cancel(SUMMARY_NOTIFICATION_ID); return }
        // Android cancels a group's children when its summary is cancelled.
        // Keep an existing summary current until the last conversation is read.
        if (counts.size == 1 && active.none { it.id == SUMMARY_NOTIFICATION_ID }) return
        val total = counts.values.sum()
        val summary = NotificationCompat.Builder(context, NotificationPolicy.channel(false, false))
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("投聊").setContentText("$total 条新消息")
            .setGroup(GROUP_KEY_MESSAGES).setGroupSummary(true).setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setSilent(true).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        try { mgr.notify(SUMMARY_NOTIFICATION_ID, summary) } catch (_: SecurityException) {}
    }

    /**
     * 来电通知：全屏意图 + 接听/拒绝。App 在后台/锁屏时由系统直接拉起来电界面。
     * data 来自后端 data-only FCM（type=call）。全屏意图和正文点击都打开独立任务里的 [CallActivity]
     * （CALL_SHOW，带 extra），由它交给 CallManager 进入 INCOMING；它在清单里声明了可越过锁屏，
     * 锁屏上点正文也无需先解锁。
     * 接听（CALL-2）按"发通知那一刻是否处于有密码锁屏"选择方式：
     * - 有密码锁屏且必需权限已授予：发广播给不导出的 [CallActionReceiver] 直接接通（通知按钮若打开 Activity，
     *   系统会先要求解锁）；
     * - 其他情况：打开 [CallActivity]（CALL_ACCEPT），由它在权限齐全时直接接听。
     * 拒绝发广播给 [CallActionReceiver] 直接拒接，不拉起界面、锁屏上无需先解锁。
     */
    // 当前展示中的来电通知（push 通路下 CallManager 不进 INCOMING，需靠它在 call:end 时收起通知）
    @Volatile private var shownCallId: String = ""
    @Volatile private var shownCallFrom: String = ""

    fun showCallNotification(callId: String, from: String, callerName: String, callType: String, recipientId: String? = accountStore.activeId()) {
        if (!acceptsRecipient(recipientId)) return
        shownCallId = callId
        shownCallFrom = from
        fun Intent.withCallExtras(action: String): Intent = apply {
            this.action = action
            putExtra(EXTRA_CALL_ID, callId)
            putExtra(EXTRA_CALL_FROM, from)
            putExtra(EXTRA_CALL_NAME, callerName)
            putExtra(EXTRA_CALL_TYPE, callType)
            putExtra(EXTRA_RECIPIENT_ID, recipientId)
            data = android.net.Uri.Builder().scheme("touliao").authority("call").appendPath(recipientId).appendPath(callId).build()
        }
        // CallActivity.intent 已带 FLAG_ACTIVITY_NEW_TASK，withCallExtras 只补 action / extra / data，不覆盖 flags
        fun callIntent(action: String) = CallActivity.intent(context, action).withCallExtras(action)
        // 拒绝：显式广播给不导出的接收器（前台广播，尽快执行）；不能沿用上面的 Activity flags
        val declineIntent = Intent(context, CallActionReceiver::class.java).withCallExtras(ACTION_CALL_DECLINE).apply {
            flags = Intent.FLAG_RECEIVER_FOREGROUND
        }
        val reqBase = from.hashCode()
        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val fullScreen = PendingIntent.getActivity(context, reqBase, callIntent(ACTION_CALL_SHOW), piFlags)
        // 接听：有密码锁屏、且必需权限（麦克风，视频再加摄像头）都已授予时走广播，不解锁即可接通；
        // 否则打开 CallActivity（响铃期间才锁屏的，系统会先要求解锁）。权限缺失时广播接收器无法接听，
        // Android 12 及以上又不能从广播里拉起通话页，走广播会"点了没反应"，所以改走 Activity 由通话页申请权限
        val accept = if (isSecureLocked() && hasCallPermissions(callType == "video")) {
            val acceptIntent = Intent(context, CallActionReceiver::class.java).withCallExtras(ACTION_CALL_ACCEPT).apply {
                flags = Intent.FLAG_RECEIVER_FOREGROUND
            }
            PendingIntent.getBroadcast(context, reqBase + 1, acceptIntent, piFlags)
        } else {
            PendingIntent.getActivity(context, reqBase + 1, callIntent(ACTION_CALL_ACCEPT), piFlags)
        }
        val decline = PendingIntent.getBroadcast(context, reqBase + 2, declineIntent, piFlags)

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
            // 后台断开 socket 后，push 通路的来电收不到取消事件时也不会永久挂着：与 CallManager
            // INCOMING 看门狗同为 60s（主叫侧早已超时结束）
            .setTimeoutAfter(CALL_NOTIFICATION_TIMEOUT_MS)
            .addAction(android.R.drawable.ic_menu_call, "接听", accept)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "拒绝", decline)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(CALL_NOTIFICATION_ID, notification)
        } catch (_: SecurityException) { /* 无权限，忽略 */ }
    }

    /** 设备此刻是否处于有密码（PIN/图案/密码/生物识别）的锁屏。只读取状态，不改动锁屏。 */
    private fun isSecureLocked(): Boolean {
        val keyguard = context.getSystemService(KeyguardManager::class.java) ?: return false
        return keyguard.isKeyguardLocked && keyguard.isDeviceSecure
    }

    /** 接听所需的运行时权限（麦克风，视频再加摄像头）是否都已授予；与 CallActionReceiver 自动接听的条件一致。 */
    private fun hasCallPermissions(video: Boolean): Boolean = CallPermissions.required(video).all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * 群通话邀请通知（CALL-11）：App 不在前台（MainActivity 不可见）时由 GroupCallInviteCoordinator 发出。
     * tag 为 callId、id 为 [CallIntents.GROUP_CALL_INVITE_NOTIFICATION_ID]；拿到群名后用同样参数再调一次即静默更新。
     * - 正文：打开 MainActivity 进入该群会话（走现有消息通知流程）；
     * - 加入：打开 CallActivity（GROUP_CALL_JOIN）。锁屏上会先要求解锁，有意为之：它不是正在响铃的来电；
     * - 忽略：广播给 [CallActionReceiver]，不拉起界面。
     * 到期由 setTimeoutAfter 自动撤掉；锁屏上只显示"收到群通话邀请"。
     */
    fun showGroupCallInvite(invite: GroupCallInvite, groupName: String, remainingMs: Long) {
        if (remainingMs <= 0) return
        val recipient = accountStore.activeId() ?: return
        if (!acceptsRecipient(recipient)) return
        val base = ("group-invite:" + invite.callId).hashCode()
        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        fun inviteUri(op: String) = android.net.Uri.Builder().scheme("touliao").authority("group-invite")
            .appendPath(recipient).appendPath(invite.callId).appendPath(op).build()

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_CONVERSATION_ID, invite.conversationId)
            putExtra(EXTRA_RECIPIENT_ID, recipient)
            data = inviteUri("open")
        }
        val joinIntent = CallActivity.intent(context, CallIntents.ACTION_GROUP_CALL_JOIN).apply {
            putExtra(CallIntents.EXTRA_GROUP_CALL_ID, invite.callId)
            putExtra(CallIntents.EXTRA_GROUP_CONVERSATION_ID, invite.conversationId)
            putExtra(CallIntents.EXTRA_GROUP_CALL_TYPE, if (invite.isVideo) "video" else "audio")
            putExtra(CallIntents.EXTRA_GROUP_INVITE_DEADLINE, System.currentTimeMillis() + remainingMs)
            putExtra(CallIntents.EXTRA_RECIPIENT_ID, recipient)
            data = inviteUri("join")
        }
        val dismissIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = CallIntents.ACTION_GROUP_CALL_INVITE_DISMISS
            putExtra(CallIntents.EXTRA_GROUP_CALL_ID, invite.callId)
            data = inviteUri("dismiss")
            addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
        }
        val open = PendingIntent.getActivity(context, base, openIntent, piFlags)
        val join = PendingIntent.getActivity(context, base + 1, joinIntent, piFlags)
        val dismiss = PendingIntent.getBroadcast(context, base + 2, dismissIntent, piFlags)

        val title = groupName.ifBlank { "群通话邀请" }
        val text = "${invite.fromName.ifBlank { "群成员" }} 邀请你加入群${if (invite.isVideo) "视频" else "语音"}通话"
        val publicVersion = NotificationCompat.Builder(context, CallIntents.GROUP_CALL_INVITE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("投聊")
            .setContentText("收到群通话邀请")
            .build()
        val notification = NotificationCompat.Builder(context, CallIntents.GROUP_CALL_INVITE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(remainingMs)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setContentIntent(open)
            .addAction(0, "加入", join)
            .addAction(0, "忽略", dismiss)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(invite.callId, CallIntents.GROUP_CALL_INVITE_NOTIFICATION_ID, notification)
        } catch (_: SecurityException) { /* 无权限，忽略 */ }
    }

    /** 撤掉某条群通话邀请通知（加入、忽略、过期、通话结束或回到前台改用横幅时） */
    fun cancelGroupCallInvite(callId: String) =
        NotificationManagerCompat.from(context).cancel(callId, CallIntents.GROUP_CALL_INVITE_NOTIFICATION_ID)

    /** 接听/拒绝后清除来电通知 */
    fun cancelCallNotification() {
        shownCallId = ""
        shownCallFrom = ""
        NotificationManagerCompat.from(context).cancel(CALL_NOTIFICATION_ID)
    }

    /**
     * 收到 call:end 时，若它对应当前展示的来电通知则收起（push 拉起的来电通知，CallManager 仍是 IDLE）。
     * callId 都有时按 callId 匹配；否则按主叫匹配。[selfDeviceSync]（本账号其他设备接听/拒绝）的 from
     * 是自己，只能按 callId 匹配，callId 缺失时视为当前这通。
     */
    fun cancelCallNotificationFor(callId: String, from: String, selfDeviceSync: Boolean): Boolean {
        val id = shownCallId
        val peer = shownCallFrom
        if (id.isEmpty() && peer.isEmpty()) return false
        val match = when {
            callId.isNotEmpty() && id.isNotEmpty() -> callId == id
            selfDeviceSync -> true
            else -> from.isNotEmpty() && from == peer
        }
        if (match) cancelCallNotification()
        return match
    }

    /**
     * 群通话进行中错过的 1v1 来电：不响铃、不振动的"未接来电（你正在群通话中）"提示。
     * 由 CallManager.rejectIfInGroupCall 调用（此时已给主叫回了忙线，来电不进 INCOMING、不弹全屏来电）。
     * tag 为 "missed-call:" + callId（缺 callId 时用主叫 id）、id 为 [CallIntents.MISSED_CALL_NOTIFICATION_ID]：
     * 同一 tag + id 重发只会更新，推送与 socket 重复到达也只有一条。
     * 点击只打开 App，不直接进私聊：来电载荷里没有会话 id；发通知时调 createPrivate 会顺带"取消隐藏"已删除的聊天
     * （有副作用）；MainActivity 是导出的，按外部可构造的 extra 去建会话有被滥用的风险。
     * 因此 intent 绝不带 callId / conversationId（MainActivity 会把带 callId 的意图当成来电）。
     */
    fun showMissedCallInGroupCall(callId: String, from: String, callerName: String, isVideo: Boolean, recipientId: String? = accountStore.activeId()) {
        if (!acceptsRecipient(recipientId)) return
        val recipient = recipientId ?: return
        val key = callId.ifEmpty { from }
        if (key.isEmpty()) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_RECIPIENT_ID, recipient)
            data = android.net.Uri.Builder().scheme("touliao").authority("missed-call").appendPath(recipient).appendPath(key).build()
        }
        val pending = PendingIntent.getActivity(
            context, ("missed-call:" + key).hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val publicVersion = NotificationCompat.Builder(context, CallIntents.MISSED_CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("投聊")
            .setContentText("未接来电")
            .build()
        val notification = NotificationCompat.Builder(context, CallIntents.MISSED_CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(callerName.ifBlank { "未接来电" })
            .setContentText("未接${if (isVideo) "视频" else "语音"}来电（你正在群通话中）")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setContentIntent(pending)
            .build()
        try {
            NotificationManagerCompat.from(context).notify("missed-call:" + key, CallIntents.MISSED_CALL_NOTIFICATION_ID, notification)
        } catch (_: SecurityException) { /* 无权限，忽略 */ }
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
            // 通话中渠道（CALL-6）：前台服务的常驻通知，拨出/接听时不响不振、不弹横幅；锁屏上照常显示以便挂断。
            val ongoing = NotificationChannel(
                CallIntents.CALL_ONGOING_CHANNEL_ID, "通话中", NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "进行中的语音/视频通话"
                setSound(null, null)
                enableVibration(false)
                enableLights(false)
                setShowBadge(false)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            mgr.createNotificationChannel(ongoing)
            // 群通话邀请渠道（CALL-11）：App 在后台时的邀请通知，默认提示音 + 振动；锁屏上隐藏详情。
            val groupInvites = NotificationChannel(
                CallIntents.GROUP_CALL_INVITE_CHANNEL_ID, "群通话邀请", NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "群语音/视频通话邀请"
                enableVibration(true)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            }
            mgr.createNotificationChannel(groupInvites)
            // 未接来电渠道：群通话中错过的 1v1 来电提示，不响铃、不振动（正在通话，不能打扰）；锁屏上隐藏详情。
            val missedCalls = NotificationChannel(
                CallIntents.MISSED_CALL_CHANNEL_ID, "未接来电", NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "群通话中错过的来电（不响铃）"
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            }
            mgr.createNotificationChannel(missedCalls)
        }
    }

    companion object {
        // Preserve the legacy channel as the migration baseline for user controls.
        const val CHANNEL_ID = "vxin_messages_v3"
        const val CALL_CHANNEL_ID = CallIntents.CALL_CHANNEL_ID
        const val EXTRA_CONVERSATION_ID = CallIntents.EXTRA_CONVERSATION_ID
        const val EXTRA_RECIPIENT_ID = CallIntents.EXTRA_RECIPIENT_ID
        // Firebase's OS-displayed notification uses id=0 with the same account/chat tag.
        const val MESSAGE_NOTIFICATION_ID = 0
        const val CALL_NOTIFICATION_ID = CallIntents.CALL_NOTIFICATION_ID
        const val CALL_NOTIFICATION_TIMEOUT_MS = 60_000L   // 与 CallManager.INCOMING_TIMEOUT_MS 一致
        const val SUMMARY_NOTIFICATION_ID = 424200        // 群组汇总通知 ID（固定，更新时覆盖）
        const val GROUP_KEY_MESSAGES = "com.touliao.app.MESSAGES"   // 消息通知分组键

        // 来电通知 Intent action / extra（CallActivity / CallActionReceiver 据此进入 INCOMING）。
        // 统一定义在 CallIntents，这里保留原名作别名，兼容已有调用方。
        const val ACTION_CALL_SHOW = CallIntents.ACTION_CALL_SHOW
        const val ACTION_CALL_ACCEPT = CallIntents.ACTION_CALL_ACCEPT
        const val ACTION_CALL_DECLINE = CallIntents.ACTION_CALL_DECLINE
        const val EXTRA_CALL_ID = CallIntents.EXTRA_CALL_ID
        const val EXTRA_CALL_FROM = CallIntents.EXTRA_CALL_FROM
        const val EXTRA_CALL_NAME = CallIntents.EXTRA_CALL_NAME
        const val EXTRA_CALL_TYPE = CallIntents.EXTRA_CALL_TYPE
    }
}
