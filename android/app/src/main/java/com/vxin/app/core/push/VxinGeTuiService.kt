package com.vxin.app.core.push

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
 * - onReceiveMessageData：App 在线时收到透传消息 → 弹本地通知（尊重前台去重）
 * 后台/锁屏时的通知由个推 SDK + 厂商通道直接展示，不进此回调。
 *
 * GTIntentService 由个推框架实例化（无 Hilt 注入），依赖经 EntryPoint 手动取。
 */
class VxinGeTuiService : GTIntentService() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface GeTuiEntryPoint {
        fun pushManager(): PushManager
        fun notificationHelper(): NotificationHelper
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

    /** 在线透传消息：弹本地通知（App 前台由 appForeground 判定去重） */
    override fun onReceiveMessageData(context: Context, msg: GTTransmitMessage?) {
        val payload = msg?.payload?.let { String(it) } ?: return
        Log.i(TAG, "个推透传: $payload")
        if (MessageNotificationBridge.appForeground) return   // 前台交给 socket UI
        runCatching {
            // 透传约定为 JSON: {"title":"...","body":"...","conversationId":"..."}
            val json = org.json.JSONObject(payload)
            entry(context).notificationHelper().showMessageNotification(
                title = json.optString("title", "新消息"),
                body = json.optString("body", "收到一条新消息"),
                conversationId = json.optString("conversationId", null),
            )
        }.onFailure { Log.w(TAG, "透传解析失败: ${it.message}") }
    }

    override fun onReceiveOnlineState(context: Context, online: Boolean) {}
    override fun onReceiveCommandResult(context: Context, cmd: GTCmdMessage?) {}
    override fun onNotificationMessageArrived(context: Context, msg: GTNotificationMessage?) {}
    override fun onNotificationMessageClicked(context: Context, msg: GTNotificationMessage?) {}

    private companion object { const val TAG = "VxinGeTui" }
}
