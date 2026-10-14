package com.touliao.app.core.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.GroupCallInviteCoordinator
import com.touliao.app.core.realtime.SocketBackgroundPolicy
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * FCM 接收服务。
 * - onNewToken：token 轮换时重新注册
 * - type=group_call_invite（data-only）：群通话邀请，交给 [GroupCallInviteCoordinator]（与 socket 邀请按 callId 去重）
 * - type=call（data-only）：1v1 来电；群通话进行中时改为回忙线 + 不响铃的未接提示（CallManager.rejectIfInGroupCall）
 * - Notification + data: foreground callbacks are handled here; Android displays
 *   background notifications using the server's stable tag and preference channel.
 *   旧版客户端不认识的 type 都走这条消息分支（按 senderName / body 展示）。
 */
@AndroidEntryPoint
class TouliaoMessagingService : FirebaseMessagingService() {

    @Inject lateinit var pushManager: PushManager
    @Inject lateinit var notificationHelper: NotificationHelper
    @Inject lateinit var callManager: CallManager
    @Inject lateinit var socketBackgroundPolicy: SocketBackgroundPolicy
    @Inject lateinit var inviteCoordinator: GroupCallInviteCoordinator

    override fun onNewToken(token: String) {
        pushManager.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (!notificationHelper.acceptsRecipient(data["recipientId"])) return
        // 群通话邀请推送（后端 data-only：type=group_call_invite）：不论前后台都交给协调器（去重/过期/忙线/横幅或通知由它决定）
        if (data["type"] == GroupCallInvitePush.TYPE) {
            runCatching {
                GroupCallInvitePush.parse { data[it] }?.let {
                    inviteCoordinator.onPushInvite(it.event, it.groupName)
                    // 后台省电断开了 socket 时临时重连：group_call:ended 才能送达并撤掉邀请通知
                    socketBackgroundPolicy.onCallPush()
                }
            }.onFailure { Log.w("VxinFcm", "群邀请推送处理失败: ${it.message}") }
            return
        }
        // 来电推送（后端 data-only：type=call）→ 走全屏来电通知，不当普通消息处理
        if (data["type"] == "call") {
            // 后端现对每次来电都推送（不再看 socket 是否在线）：前台不弹全屏通知以免与 socket 来电双响；
            // 直接交给 CallManager（同 peer/callId 去重；socket 半死时由此补上来电）
            if (MessageNotificationBridge.appForeground) {
                callManager.incomingFromPush(
                    from = data["from"].orEmpty(),
                    callType = data["callType"] ?: "audio",
                    callerName = data["callerName"].orEmpty(),
                    callId = data["callId"].orEmpty(),
                )
                return
            }
            // 群通话进行中：不弹全屏来电，回忙线（主叫 id 可用时）+ 不响铃的未接提示
            if (callManager.rejectIfInGroupCall(data["from"].orEmpty(), data["callType"] ?: "audio", data["callerName"].orEmpty(), data["callId"].orEmpty())) return
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
