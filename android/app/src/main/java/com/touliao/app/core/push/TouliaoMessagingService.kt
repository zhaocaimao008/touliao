package com.touliao.app.core.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * FCM 接收服务。
 * - onNewToken：token 轮换时重新注册
 * - Notification + data: foreground callbacks are handled here; Android displays
 *   background notifications using the server's stable tag and preference channel.
 */
@AndroidEntryPoint
class TouliaoMessagingService : FirebaseMessagingService() {

    @Inject lateinit var pushManager: PushManager
    @Inject lateinit var notificationHelper: NotificationHelper

    override fun onNewToken(token: String) {
        pushManager.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (!notificationHelper.acceptsRecipient(data["recipientId"])) return
        // 来电推送（后端 data-only：type=call）→ 走全屏来电通知，不当普通消息处理
        if (data["type"] == "call") {
            notificationHelper.showCallNotification(
                callId = data["callId"].orEmpty(),
                from = data["from"].orEmpty(),
                callerName = data["callerName"].orEmpty(),
                callType = data["callType"] ?: "audio",
                recipientId = data["recipientId"],
            )
            return
        }
        val title = message.notification?.title ?: data["senderName"] ?: "新消息"
        val body = message.notification?.body ?: data["body"] ?: ""
        // Socket updates the foreground UI; avoid a second message alert.
        if (MessageNotificationBridge.appForeground) return
        // badge 为后端 SQL COUNT(未读)>last_read_at 算出的真实未读数（见 push.js pushNewMessage），
        // 用它做角标而非本地聚合条数（本地最多只缓存 5 条摘要，不能代表真实未读）。
        val badge = (data["conversationUnreadCount"] ?: data["badge"])?.toIntOrNull()
        notificationHelper.showMessageNotification(title, body, data["conversationId"], badge, data["recipientId"],
            messageId = data["messageId"], sound = data["sound"] != "false", vibrate = data["vibrate"] == "true", detailPreview = data["detailPreview"] != "false")
    }
}
