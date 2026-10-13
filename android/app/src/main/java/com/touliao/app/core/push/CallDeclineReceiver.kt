package com.touliao.app.core.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.di.AppScope
import com.touliao.app.core.realtime.SocketBackgroundPolicy
import com.touliao.app.core.realtime.SocketManager
import com.touliao.app.core.realtime.SocketStatus
import com.touliao.app.core.util.AppForeground
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

/**
 * 来电通知上的「拒绝」(CALL-2)：通知用 PendingIntent.getBroadcast 发到这里，直接拒接，不拉起 MainActivity。
 * 此前「拒绝」是 getActivity：有锁屏密码时得先解锁才能拒接，执行后 MainActivity 还被设成越过锁屏显示。
 * 清单里 exported=false，只接收本应用通知发来的显式广播。
 * Hilt 注入发生在生成的父类 onReceive 中（Hilt Gradle 插件自动插入 super.onReceive 调用）。
 */
@AndroidEntryPoint
class CallDeclineReceiver : BroadcastReceiver() {

    @Inject lateinit var callManager: CallManager
    @Inject lateinit var socketManager: SocketManager
    @Inject lateinit var notificationHelper: NotificationHelper
    @Inject lateinit var socketBackgroundPolicy: SocketBackgroundPolicy
    @Inject @field:AppScope lateinit var appScope: CoroutineScope

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != NotificationHelper.ACTION_CALL_DECLINE) return
        if (!notificationHelper.acceptsRecipient(intent.getStringExtra(NotificationHelper.EXTRA_RECIPIENT_ID))) return
        notificationHelper.cancelCallNotification()
        // 后台被唤醒时 socket 可能已断，拒接信令需要它 → 先确保连接
        // （未连上时 call:response 进 socket.io 的发送缓冲，连上后自动发出）。
        // 不再拉起 Activity，App 仍在后台：若此前因后台省电断开过，交给后台策略在通话收尾后再断开，
        // 避免这条临时连接在后台一直挂着耗电。
        socketManager.connect()
        socketBackgroundPolicy.onCallPush()
        rejectFromNotification(
            callManager,
            from = intent.getStringExtra(NotificationHelper.EXTRA_CALL_FROM).orEmpty(),
            callType = intent.getStringExtra(NotificationHelper.EXTRA_CALL_TYPE) ?: "audio",
            callerName = intent.getStringExtra(NotificationHelper.EXTRA_CALL_NAME).orEmpty(),
            callId = intent.getStringExtra(NotificationHelper.EXTRA_CALL_ID).orEmpty(),
        )
        // 不再拉起界面：App 不在前台时没有 CallHost 消费结束态，ENDED 会一直留到下次打开 App 时
        // 才闪一下"通话结束"页 → 直接归零（只在 ENDED 时生效，忙线回拒时进行中的通话不受影响）。
        // App 在前台时照旧交给 CallHost 展示结束态后自动关闭。
        if (!AppForeground.isForeground) callManager.consumeEnded()
        // 广播返回后后台进程可能很快被回收：goAsync 撑到连接建立、缓冲的 call:response 发出。
        // 通知发的是前台广播(10s 超时)，这里最多等约 5.5s。
        val pending = goAsync()
        appScope.launch {
            try {
                withTimeoutOrNull(SOCKET_WAIT_MS) { socketManager.status.first { it == SocketStatus.CONNECTED } }
                delay(FLUSH_GRACE_MS)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        private const val SOCKET_WAIT_MS = 5_000L
        private const val FLUSH_GRACE_MS = 500L

        /**
         * 通知拒接（原 MainActivity 处理 ACTION_CALL_DECLINE 的逻辑，现与本接收器共用）：
         * 先按推送内容进入 INCOMING（App 被杀/后台时 CallManager 仍是 IDLE），再 reject() 回拒绝信令。
         * 只在当前确实是这通来电时才 reject()：正在和别人通话时点了另一通来电通知的「拒绝」，
         * incomingFromPush 已按忙线回拒，不能再 reject() 把进行中的通话挂掉。须在主线程调用。
         */
        fun rejectFromNotification(callManager: CallManager, from: String, callType: String, callerName: String, callId: String) {
            callManager.incomingFromPush(from, callType, callerName, callId)
            val s = callManager.state.value
            if (s.stage == CallStage.INCOMING && s.peerId == from) callManager.reject()
        }
    }
}
