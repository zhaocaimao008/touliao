package com.touliao.app.core.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.touliao.app.core.call.CallIntents
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.call.CallUiRules
import com.touliao.app.core.call.GroupCallInviteCoordinator
import com.touliao.app.core.call.GroupCallManager
import com.touliao.app.core.di.AppScope
import com.touliao.app.core.realtime.SocketBackgroundPolicy
import com.touliao.app.core.realtime.SocketManager
import com.touliao.app.core.realtime.SocketStatus
import com.touliao.app.core.util.AppForeground
import com.touliao.app.feature.call.CallActivity
import com.touliao.app.feature.call.CallPermissions
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

/**
 * 通知上的通话操作（CALL-2 / CALL-6 / CALL-11），全部不拉起 MainActivity、锁屏上无需先解锁：
 * - 拒绝（来电通知）：直接拒接；
 * - 接听（来电通知，仅在发通知那一刻处于有密码锁屏时走这里）：权限齐全时直接接通，并尽力打开通话页；
 * - 挂断（"通话中"通知）：按 callKind + callId 挂断对应的那一路，防止旧通知挂掉新的一通；
 * - 忽略（群通话邀请通知）：交给邀请协调器关掉这条邀请。
 * 清单里 exported=false，只接收本应用通知发来的显式广播。
 * Hilt 注入发生在生成的父类 onReceive 中（Hilt Gradle 插件自动插入 super.onReceive 调用）。
 */
@AndroidEntryPoint
class CallActionReceiver : BroadcastReceiver() {

    @Inject lateinit var callManager: CallManager
    @Inject lateinit var groupCallManager: GroupCallManager
    @Inject lateinit var socketManager: SocketManager
    @Inject lateinit var notificationHelper: NotificationHelper
    @Inject lateinit var socketBackgroundPolicy: SocketBackgroundPolicy
    @Inject lateinit var inviteCoordinator: GroupCallInviteCoordinator
    @Inject @field:AppScope lateinit var appScope: CoroutineScope

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            CallIntents.ACTION_CALL_DECLINE -> onDecline(intent)
            CallIntents.ACTION_CALL_ACCEPT -> onAccept(context, intent)
            CallIntents.ACTION_CALL_HANGUP -> onHangup(intent)
            CallIntents.ACTION_GROUP_CALL_INVITE_DISMISS ->
                inviteCoordinator.dismiss(intent.getStringExtra(CallIntents.EXTRA_GROUP_CALL_ID).orEmpty())
        }
    }

    /** 拒绝：沿用原拒绝接收器的逻辑（本类已取代它）。 */
    private fun onDecline(intent: Intent) {
        if (!notificationHelper.acceptsRecipient(intent.getStringExtra(CallIntents.EXTRA_RECIPIENT_ID))) return
        notificationHelper.cancelCallNotification()
        // 后台被唤醒时 socket 可能已断，拒接信令需要它 → 先确保连接
        // （未连上时 call:response 进 socket.io 的发送缓冲，连上后自动发出）。
        // 不再拉起 Activity，App 仍在后台：若此前因后台省电断开过，交给后台策略在通话收尾后再断开，
        // 避免这条临时连接在后台一直挂着耗电。
        socketManager.connect()
        socketBackgroundPolicy.onCallPush()
        rejectFromNotification(
            callManager,
            from = intent.getStringExtra(CallIntents.EXTRA_CALL_FROM).orEmpty(),
            callType = intent.getStringExtra(CallIntents.EXTRA_CALL_TYPE) ?: "audio",
            callerName = intent.getStringExtra(CallIntents.EXTRA_CALL_NAME).orEmpty(),
            callId = intent.getStringExtra(CallIntents.EXTRA_CALL_ID).orEmpty(),
        )
        // 不再拉起界面：App 不在前台时没有界面消费结束态，ENDED 会一直留到下次打开 App 时
        // 才闪一下"通话结束"页 → 直接归零（只在 ENDED 时生效，忙线回拒时进行中的通话不受影响）。
        // App 在前台时照旧交给通话界面展示结束态后自动关闭。
        if (!AppForeground.isForeground) callManager.consumeEnded()
        awaitSocketFlush()
    }

    /**
     * 锁屏接听：发通知那一刻处于有密码锁屏、且必需权限已授予时，"接听"按钮发到这里，不解锁即可接通。
     * 先按推送内容进入 INCOMING（App 被杀/后台时 CallManager 仍是 IDLE）；只有当前确实是这通来电、
     * 且必需权限（麦克风，视频再加摄像头）此刻仍都已授权时才直接接听，否则停在来电页由界面申请权限
     * （发通知后才被收回权限的兜底）。
     * 来电通知由 CallManager.accept() 收起；没接听时保留，用户仍可从通知进入来电页。
     * 打开通话页是尽力而为：Android 12 及以上会拦截从通知广播里启动界面，此时用户点"通话中"通知进入。
     */
    private fun onAccept(context: Context, intent: Intent) {
        if (!notificationHelper.acceptsRecipient(intent.getStringExtra(CallIntents.EXTRA_RECIPIENT_ID))) return
        val from = intent.getStringExtra(CallIntents.EXTRA_CALL_FROM).orEmpty()
        val callId = intent.getStringExtra(CallIntents.EXTRA_CALL_ID).orEmpty()
        // 这通已经接听（连点"接听"、通知收起前又点了一次）：不能再走 incomingFromPush——它会把
        // 进行中的同一通当成另一通来电，回忙线拒接把刚接通的通话挂掉。只尽力打开通话页。
        val cur = callManager.state.value
        if (!cur.isCaller && cur.peerId == from && from.isNotEmpty() &&
            (cur.stage == CallStage.CONNECTING || cur.stage == CallStage.CONNECTED) &&
            (callId.isEmpty() || cur.callId.isEmpty() || cur.callId == callId)
        ) {
            CallActivity.open(context, CallIntents.ACTION_CALL_RESUME)
            return
        }
        socketManager.connect()
        socketBackgroundPolicy.onCallPush()
        callManager.incomingFromPush(
            from,
            intent.getStringExtra(CallIntents.EXTRA_CALL_TYPE) ?: "audio",
            intent.getStringExtra(CallIntents.EXTRA_CALL_NAME).orEmpty(),
            callId,
        )
        val s = callManager.state.value
        if (s.stage == CallStage.INCOMING && s.peerId == from) {
            val granted = CallPermissions.required(s.isVideo).all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }
            if (granted) callManager.accept()
            CallActivity.open(context, CallIntents.ACTION_CALL_RESUME)
        }
        // 接听信令需要 socket：撑到连接建立、缓冲的应答发出
        awaitSocketFlush()
    }

    /**
     * "通话中"通知的挂断：只挂断通知对应的那一路。callId 为空（占位通知或旧服务端）时不校验，
     * 否则必须与当前通话一致，防止旧通知挂掉新的一通。
     * App 不在前台时没有界面消费结束态，直接归零，避免下次打开 App 时闪一下结束页。
     */
    private fun onHangup(intent: Intent) {
        val kind = intent.getStringExtra(CallIntents.EXTRA_CALL_KIND)
        val id = intent.getStringExtra(CallIntents.EXTRA_CALL_ID).orEmpty()
        if (kind == CallIntents.KIND_GROUP) {
            val g = groupCallManager.state.value
            if (CallUiRules.isGroupActive(g.stage) && (id.isEmpty() || g.callId.isEmpty() || id == g.callId)) {
                groupCallManager.hangup()
                if (!AppForeground.isForeground) groupCallManager.consumeEnded()
            }
        } else {
            val c = callManager.state.value
            if (CallUiRules.isP2pActive(c.stage) && (id.isEmpty() || c.callId.isEmpty() || id == c.callId)) {
                callManager.hangup()
                if (!AppForeground.isForeground) callManager.consumeEnded()
            }
        }
        // 挂断信令发出前进程可能被回收：同样撑到 socket 连上并留出发送时间
        awaitSocketFlush()
    }

    /**
     * 广播返回后后台进程可能很快被回收：goAsync 撑到连接建立、缓冲的信令发出。
     * 通知发的是前台广播(10s 超时)，这里最多等约 5.5s。须在 onReceive 内同步调用。
     */
    private fun awaitSocketFlush() {
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
         * 通知拒接（MainActivity 兜底处理旧版拒绝意图时与本接收器共用）：
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
