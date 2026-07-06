package com.vxin.app.core.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * FCM 接收服务。
 * - onNewToken：token 轮换时重新注册
 * - onMessageReceived：前台收到消息时手动弹通知（后台由系统托盘自动展示 notification 块）
 */
@AndroidEntryPoint
class VxinMessagingService : FirebaseMessagingService() {

    @Inject lateinit var pushManager: PushManager
    @Inject lateinit var notificationHelper: NotificationHelper

    override fun onNewToken(token: String) {
        pushManager.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        // 来电推送（后端 data-only：type=call）→ 走全屏来电通知，不当普通消息处理
        if (data["type"] == "call") {
            notificationHelper.showCallNotification(
                callId = data["callId"].orEmpty(),
                from = data["from"].orEmpty(),
                callerName = data["callerName"].orEmpty(),
                callType = data["callType"] ?: "audio",
            )
            return
        }
        val title = message.notification?.title ?: data["senderName"] ?: "新消息"
        val body = message.notification?.body ?: data["body"] ?: ""
        notificationHelper.showMessageNotification(title, body, data["conversationId"])
    }
}
