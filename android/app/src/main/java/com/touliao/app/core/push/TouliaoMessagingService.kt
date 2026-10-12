package com.touliao.app.core.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.realtime.SocketBackgroundPolicy
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
    @Inject lateinit var callManager: CallManager
    @Inject lateinit var socketBackgroundPolicy: SocketBackgroundPolicy

    override fun onNewToken(token: String) {
        pushManager.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (!notificationHelper.acceptsRecipient(data["recipientId"])) return
        // 来电推送（后端 data-only：type=call）→ 走全屏来电通知，不当普通消息处理
        if (data["type"] == "call") {
            // 鍚庣鐜板姣忔鏉ョ數閮芥帹閫侊紙涓嶅啀鐪?socket 鏄惁鍦ㄧ嚎锛夛細鍓嶅彴涓嶅脊鍏ㄥ睆閫氱煡浠ュ厤涓?socket 鏉ョ數鍙屽搷锛?            // 鐩存帴浜ょ粰 CallManager锛堝悓 peer/callId 鍘婚噸锛泂ocket 鍗婃鏃剁敱姝よˉ涓婃潵鐢碉級
            if (MessageNotificationBridge.appForeground) {
                callManager.incomingFromPush(
                    from = data["from"].orEmpty(),
                    callType = data["callType"] ?: "audio",
                    callerName = data["callerName"].orEmpty(),
                    callId = data["callId"].orEmpty(),
                )
                return
            }
            notificationHelper.showCallNotification(
                callId = data["callId"].orEmpty(),
                from = data["from"].orEmpty(),
                callerName = data["callerName"].orEmpty(),
                callType = data["callType"] ?: "audio",
                recipientId = data["recipientId"],
            )
            // 后台省电断开了 socket 时临时重连：主叫取消/其他设备接听的 call:end 才能送达并收起通知
            socketBackgroundPolicy.onCallPush()
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
