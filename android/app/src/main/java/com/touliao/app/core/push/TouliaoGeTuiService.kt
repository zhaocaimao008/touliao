package com.touliao.app.core.push

import android.content.Context
import android.util.Log
import com.igexin.sdk.GTIntentService
import com.igexin.sdk.message.GTCmdMessage
import com.igexin.sdk.message.GTNotificationMessage
import com.igexin.sdk.message.GTTransmitMessage
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * 个推消息接收服务（国产 ROM 推送覆盖）。
 * - onReceiveClientId：拿到个推 CID → 上报后端（platform='getui'）
 * - onReceiveMessageData：App 在线时收到透传消息 → 弹本地通知（尊重前台去重）；
 *   群通话邀请（type=group_call_invite）不论前后台都交给 GroupCallInviteCoordinator；
 *   群通话进行中来的 1v1（type=call）改为回忙线 + 不响铃的未接提示（CallManager.rejectIfInGroupCall）
 * 后台/锁屏时的通知由个推 SDK + 厂商通道直接展示，不进此回调（群邀请的厂商通道点击由 MainActivity 处理）。
 *
 * GTIntentService 由个推框架实例化（无 Hilt 注入），依赖经 EntryPoint 手动取。
 */
class TouliaoGeTuiService : GTIntentService() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface GeTuiEntryPoint {
        fun pushManager(): PushManager
        fun notificationHelper(): NotificationHelper
        fun socketBackgroundPolicy(): com.touliao.app.core.realtime.SocketBackgroundPolicy
        fun callManager(): com.touliao.app.core.call.CallManager
        fun groupCallInviteCoordinator(): com.touliao.app.core.call.GroupCallInviteCoordinator
    }

    private fun entry(ctx: Context) =
        EntryPointAccessors.fromApplication(ctx.applicationContext, GeTuiEntryPoint::class.java)

    /** 拿到 CID：上报后端注册 */
    override fun onReceiveClientId(context: Context, clientId: String?) {
        Log.i(TAG, "个推 CID = ${clientId?.take(12)}…")
        if (clientId.isNullOrBlank()) return
        runCatching { entry(context).pushManager().registerGeTuiCid(clientId) }
            .onFailure { Log.e(TAG, "上报 CID 失败: ${it.message}") }
    }

    /**
     * 在线透传消息：群通话邀请交给协调器（不论前后台）；来电走全屏来电通知；其余弹普通消息通知
     * （App 前台由 appForeground 判定去重，前台交给 socket UI）。
     */
    override fun onReceiveMessageData(context: Context, msg: GTTransmitMessage?) {
        val payload = msg?.payload?.let { String(it) } ?: return
        runCatching {
            // 透传约定为 JSON: {"title":"...","body":"...","type":"...","conversationId":"..."}
            // 来电透传(type=call，后端 pushCallToCid)：复用 FCM 同款全屏来电通知
            // （showCallNotification 的 fullScreenIntent + 接听/拒绝动作，字段键名与 FCM data-only 对齐）
            val json = org.json.JSONObject(payload)
            val recipient = json.optString("recipientId")
            if (!entry(context).notificationHelper().acceptsRecipient(recipient)) return
            // 群通话邀请透传（type=group_call_invite，后端 pushGroupCallInviteToCid）：不按前后台短路，
            // 交给协调器（与 socket / FCM 按 callId 去重；前台横幅 + 短振，后台带"加入 / 忽略"的通知）
            if (json.optString("type") == GroupCallInvitePush.TYPE) {
                GroupCallInvitePush.parse { key -> json.optString(key).takeIf { v -> v.isNotEmpty() } }?.let {
                    entry(context).groupCallInviteCoordinator().onPushInvite(it.event, it.groupName)
                    // 同 FCM：后台省电断开了 socket 时临时重连，以便收到 group_call:ended 撤掉邀请通知
                    entry(context).socketBackgroundPolicy().onCallPush()
                }
                return
            }
            if (MessageNotificationBridge.appForeground) return   // 前台交给 socket UI
            if (json.optString("type") == "call") {
                // 群通话进行中：不弹全屏来电，回忙线（主叫 id 可用时）+ 不响铃的未接提示
                if (entry(context).callManager().rejectIfInGroupCall(
                        json.optString("from"), json.optString("callType", "audio"),
                        json.optString("callerName"), json.optString("callId"),
                    )
                ) return
                entry(context).notificationHelper().showCallNotification(
                    callId = json.optString("callId"),
                    from = json.optString("from"),
                    callerName = json.optString("callerName"),
                    callType = json.optString("callType", "audio"),
                    recipientId = recipient,
                )
                // 同 FCM：后台省电断开了 socket 时临时重连，以便收到取消/他端接听并收起通知
                entry(context).socketBackgroundPolicy().onCallPush()
                return
            }
            entry(context).notificationHelper().showMessageNotification(
                title = json.optString("title", "新消息"),
                body = json.optString("body", "收到一条新消息"),
                conversationId = json.optString("conversationId", null),
                unreadCount = if (json.has("conversationUnreadCount")) json.optInt("conversationUnreadCount") else null,
                messageId = json.optString("messageId"),
                sound = json.optBoolean("sound", true),
                vibrate = json.optBoolean("vibrate", false),
                detailPreview = json.optBoolean("detailPreview", true),
                recipientId = recipient,
            )
        }.onFailure { Log.w(TAG, "透传解析失败: ${it.message}") }
    }

    override fun onReceiveOnlineState(context: Context, online: Boolean) {}
    override fun onReceiveCommandResult(context: Context, cmd: GTCmdMessage?) {}
    override fun onNotificationMessageArrived(context: Context, msg: GTNotificationMessage?) {}
    override fun onNotificationMessageClicked(context: Context, msg: GTNotificationMessage?) {}

    private companion object { const val TAG = "VxinGeTui" }
}
