package com.touliao.app.core.push

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
        // App 在前台时不弹 FCM 通知：此刻 socket 已实时收到消息并更新 UI（MessageNotificationBridge
        // 负责前台震动），再弹通知会重复打扰。后台/锁屏时 onMessageReceived 的 notification 块
        // 由系统托盘直接展示（不进此回调），故这里只处理前台 data 消息。
        if (MessageNotificationBridge.appForeground) return
        // badge 为后端 SQL COUNT(未读)>last_read_at 算出的真实未读数（见 push.js pushNewMessage），
        // 用它做角标而非本地聚合条数（本地最多只缓存 5 条摘要，不能代表真实未读）。
        val badge = data["badge"]?.toIntOrNull()
        notificationHelper.showMessageNotification(title, body, data["conversationId"], badge)
    }
}
