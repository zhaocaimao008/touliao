package com.touliao.app.feature.call

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.touliao.app.MainActivity
import com.touliao.app.core.call.CallIntents
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.call.CallUiKind
import com.touliao.app.core.call.CallUiPresence
import com.touliao.app.core.call.CallUiRules
import com.touliao.app.core.call.GroupCallInviteCoordinator
import com.touliao.app.core.call.GroupCallManager
import com.touliao.app.core.push.NotificationHelper
import com.touliao.app.core.realtime.SocketManager
import com.touliao.app.ui.components.FeedbackKind
import com.touliao.app.ui.components.TouliaoFeedback
import com.touliao.app.ui.theme.TouliaoMedia
import com.touliao.app.ui.theme.VxinTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 通话页（CALL-2）：所有全屏通话界面（1v1 来电 / 呼出 / 连接中 / 通话中 / 结束页，群通话连接中 / 通话中 / 结束）
 * 的唯一宿主，也是整个 App 唯一可以越过锁屏显示的页面。
 *
 * - 独立任务（taskAffinity=包名.call）、不进最近任务；清单声明越过锁屏，API 24-26 由代码加窗口标志。
 * - 亮屏只在 1v1 响铃时动态打开，响铃结束立即撤掉；永不请求解锁窗口标志，也不设常亮
 *   （通话中常亮由 Compose 里的 KeepScreenOnDuringCall 按 View 负责）。
 * - 自己不存通话状态，只是 CallManager / GroupCallManager 的视图：被系统回收后可从通知、小窗或
 *   MainActivity 自动拉起重建。
 * - 只在两种情况下结束自己：两路通话都回到 IDLE，或者经 [leaveCallUi] 离开（离开前设备锁着就先解锁）。
 *   这样不会和 MainActivity 的自动拉起形成循环，也保证离开通话页的每条路都要先解锁。
 */
@AndroidEntryPoint
class CallActivity : ComponentActivity() {

    @Inject lateinit var callManager: CallManager
    @Inject lateinit var groupCallManager: GroupCallManager
    @Inject lateinit var socketManager: SocketManager
    @Inject lateinit var notificationHelper: NotificationHelper
    @Inject lateinit var inviteCoordinator: GroupCallInviteCoordinator

    /** 正在离开通话页（等待解锁或已在 proceed 中）：防止连点收起 / 回复消息重复触发 */
    private var leaving = false

    /**
     * 已进入 [proceed]：本页随后一定会自己结束。before()（如拒接后回复）可能同步把通话归零，
     * 此时收集器不抢先结束本页，保证先打开主界面、再结束通话任务，顺序固定。
     * 只在 proceed 里置 true；等待解锁期间不置，那时通话结束仍由收集器及时关掉本页。
     */
    private var proceeding = false

    /** 上次应用到窗口的亮屏设置；窗口默认不亮屏，所以初值为 false */
    private var screenOnApplied = false

    override fun onCreate(savedInstanceState: Bundle?) {
        // 通话页固定深色底：状态栏 / 导航栏透明并用浅色图标
        enableEdgeToEdge(
            SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        // API 24-26 不认清单里的越过锁屏属性，改加窗口标志（只在本页，MainActivity 永不加）
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        }
        // 重建（savedInstanceState 非空）时意图已在上一个实例里处理并消费过，不再重复处理
        if (savedInstanceState == null) routeIntent(intent)
        // 没有任何通话（拒接后的迟到意图、空推送、进程被杀后重建等）：在显示任何内容之前直接结束，
        // 不在锁屏上留下空页面
        if (CallUiRules.displayKind(callManager.state.value, groupCallManager.state.value) == CallUiKind.NONE) {
            // 配置变更重建时，旧实例的 onStop 没有写 false（以为新实例会紧接着 onStart）；
            // 本实例在这里就结束、不会走到 onStart，补写 false，否则 MainActivity 以后永远不再自动拉起通话页。
            // singleTask 只有这一个实例，不会误改别的实例的在场标记。
            if (savedInstanceState != null) CallUiPresence.setCallUiStarted(false)
            finishAndRemoveTask()
            return
        }
        applyTurnScreenOn(CallUiRules.turnScreenOn(callManager.state.value))
        // 不用 repeatOnLifecycle：熄屏（STOPPED）期间通话结束也要立即关掉本页，否则下次亮屏仍留在锁屏上；
        // 亮屏设置同理要随响铃结束及时撤掉。lifecycleScope 在主线程执行，Activity 销毁时自动取消。
        lifecycleScope.launch {
            combine(callManager.state, groupCallManager.state) { c, g -> c to g }.collect { (c, g) ->
                applyTurnScreenOn(CallUiRules.turnScreenOn(c))
                if (CallUiRules.displayKind(c, g) == CallUiKind.NONE && !isFinishing && !proceeding) finishAndRemoveTask()
            }
        }
        // 兜底吞掉返回键：各阶段的返回键由 CallHost / GroupCallHost 的 BackHandler 处理（收起或吞掉），
        // 它们后注册、优先级更高；万一某个阶段没有处理，也不能让系统默认行为把本页关掉。
        onBackPressedDispatcher.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })
        setContent {
            VxinTheme(darkTheme = true) {
                Surface(Modifier.fillMaxSize(), color = TouliaoMedia.canvas) {
                    val c by callManager.state.collectAsStateWithLifecycle()
                    val g by groupCallManager.state.collectAsStateWithLifecycle()
                    when (CallUiRules.displayKind(c, g)) {
                        CallUiKind.P2P -> CallHost(leaveCallUi = { leaveCallUi(it) })
                        CallUiKind.GROUP -> GroupCallHost(leaveCallUi = { leaveCallUi(it) })
                        CallUiKind.NONE -> Unit
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        routeIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        // 通话页在场：MainActivity 据此不再重复拉起本页
        CallUiPresence.setCallUiStarted(true)
    }

    override fun onStop() {
        super.onStop()
        // 配置变更引起的 onStop 不写 false（新实例紧接着 onStart）
        if (!isChangingConfigurations) CallUiPresence.setCallUiStarted(false)
    }

    override fun onResume() {
        super.onResume()
        // 从锁屏广播接听等后台路径进入时前台服务可能没起来，进入通话页立即补起
        callManager.onAppForeground()
        groupCallManager.onAppForeground()
    }

    /** 按 action 分发通知 / 小窗 / MainActivity 拉起本页时带的意图，处理完即消费，重建时不重复触发。 */
    private fun routeIntent(i: Intent?) {
        if (i == null) return
        when (i.action) {
            CallIntents.ACTION_CALL_SHOW -> handleIncoming(i, accept = false)
            CallIntents.ACTION_CALL_ACCEPT -> handleIncoming(i, accept = true)
            CallIntents.ACTION_CALL_RESUME -> {
                // 回到全屏：只对正在进行的那一路清掉「用户主动收起」
                if (CallUiRules.isP2pActive(callManager.state.value.stage)) callManager.setMinimized(false)
                if (CallUiRules.isGroupActive(groupCallManager.state.value.stage)) groupCallManager.setMinimized(false)
            }
            CallIntents.ACTION_GROUP_CALL_JOIN -> handleGroupJoin(i)
            else -> return
        }
        i.action = null
        i.removeExtra(CallIntents.EXTRA_CALL_ID)
        i.removeExtra(CallIntents.EXTRA_GROUP_CALL_ID)
    }

    /**
     * 来电通知（全屏意图 / 正文 / 「接听」按钮）拉起：按推送内容进入来电状态（App 被杀或后台时 CallManager 仍是 IDLE）。
     * 不收起来电通知（由 CallManager.accept() / cleanup() 负责），这样按 Home 后还能从通知回到来电页。
     * 「接听」只在这通来电确实在响、且必需的麦克风 / 摄像头权限都已授予时才直接接通；否则停在来电页，
     * 由界面申请权限后用户再点接听。
     */
    private fun handleIncoming(i: Intent, accept: Boolean) {
        if (!notificationHelper.acceptsRecipient(i.getStringExtra(CallIntents.EXTRA_RECIPIENT_ID))) return
        val from = i.getStringExtra(CallIntents.EXTRA_CALL_FROM).orEmpty()
        val type = i.getStringExtra(CallIntents.EXTRA_CALL_TYPE) ?: "audio"
        val name = i.getStringExtra(CallIntents.EXTRA_CALL_NAME).orEmpty()
        val callId = i.getStringExtra(CallIntents.EXTRA_CALL_ID).orEmpty()
        // 后台被唤醒时 socket 可能已断，接听的信令需要它 → 先确保连接
        socketManager.connect()
        callManager.incomingFromPush(from, type, name, callId)
        if (!accept) return
        val state = callManager.state.value
        val granted = CallPermissions.required(state.isVideo).all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
        if (state.stage == CallStage.INCOMING && state.peerId == from && granted) callManager.accept()
    }

    /** 群邀请通知的「加入」：校验收件人后交给邀请协调器加入（过期、忙线等由协调器判断并给出提示）。 */
    private fun handleGroupJoin(i: Intent) {
        if (!notificationHelper.acceptsRecipient(i.getStringExtra(CallIntents.EXTRA_RECIPIENT_ID))) return
        socketManager.connect()
        val err = inviteCoordinator.joinFromIntent(
            i.getStringExtra(CallIntents.EXTRA_GROUP_CALL_ID).orEmpty(),
            i.getStringExtra(CallIntents.EXTRA_GROUP_CONVERSATION_ID).orEmpty(),
            i.getStringExtra(CallIntents.EXTRA_GROUP_CALL_TYPE) == "video",
            i.getLongExtra(CallIntents.EXTRA_GROUP_INVITE_DEADLINE, 0L),
        )
        // 加入失败时本页随后会因没有通话而结束，提示用 applicationContext 发，不随本页消失
        if (err != null) TouliaoFeedback.show(applicationContext, err, FeedbackKind.ERROR)
    }

    /**
     * 亮屏设置：只在 1v1 响铃时打开，其余时候撤掉。和上次相同则不动。
     * 只动亮屏，不加请求解锁和常亮的窗口标志。
     */
    private fun applyTurnScreenOn(on: Boolean) {
        if (screenOnApplied == on) return
        screenOnApplied = on
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setTurnScreenOn(on)
        } else {
            @Suppress("DEPRECATION")
            val flag = WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            if (on) window.addFlags(flag) else window.clearFlags(flag)
        }
    }

    /**
     * 离开通话页（收起成小窗、拒接后回复消息）。设备锁着时先请求解锁：
     * 解锁成功（或系统报错）才执行 [before] 并进入 MainActivity；用户取消解锁就留在通话页。
     * API 24/25 没有请求解锁的接口，直接离开——此时 MainActivity 会被系统锁屏盖住，是安全的。
     */
    private fun leaveCallUi(before: () -> Unit) {
        if (leaving || isFinishing) return
        val keyguard: KeyguardManager? = getSystemService(KeyguardManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && keyguard != null && keyguard.isKeyguardLocked) {
            leaving = true
            keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() {
                    proceed(before)
                }

                override fun onDismissError() {
                    proceed(before)
                }

                override fun onDismissCancelled() {
                    leaving = false
                }
            })
        } else {
            proceed(before)
        }
    }

    /** 真正离开：先执行 [before]（收起 / 拒接并准备回复），再回到主任务，最后结束整个通话任务。 */
    private fun proceed(before: () -> Unit) {
        leaving = true
        proceeding = true
        before()
        runCatching { startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        // 等待解锁期间通话已结束时，本页可能已被收集器结束，不重复结束
        if (!isFinishing) finishAndRemoveTask()
    }

    companion object {
        /** 指向本页的显式 Intent（带 action 和 NEW_TASK），不带 extras 和 data，由调用方自己补。 */
        fun intent(context: Context, action: String = CallIntents.ACTION_CALL_RESUME): Intent =
            Intent(context, CallActivity::class.java)
                .setAction(action)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        /** 打开通话页；系统拒绝启动（如后台启动限制）时返回 false，不抛异常。 */
        fun open(context: Context, action: String = CallIntents.ACTION_CALL_RESUME): Boolean =
            runCatching { context.startActivity(intent(context, action)) }.isSuccess
    }
}
