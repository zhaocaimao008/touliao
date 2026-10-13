package com.touliao.app

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.lifecycle.lifecycleScope
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.call.GroupCallManager
import com.touliao.app.core.call.GroupCallStage
import com.touliao.app.core.push.CallDeclineReceiver
import com.touliao.app.core.push.NotificationHelper
import com.touliao.app.core.realtime.SocketManager
import com.touliao.app.navigation.AppNavigation
import com.touliao.app.navigation.PendingConversationHolder
import com.touliao.app.ui.theme.VxinThemeWithPref
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var callManager: CallManager
    @Inject lateinit var groupCallManager: GroupCallManager
    @Inject lateinit var socketManager: SocketManager
    @Inject lateinit var notificationHelper: NotificationHelper

    /** 本 Activity 当前是否被设成越过锁屏/亮屏（只由来电意图设上，通话结束或收起小窗时撤掉） */
    private var showingOverLockscreen = false

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        // SplashScreen API：冷启动显示品牌启动屏，深浅两套窗口背景避免闪白/闪黑
        installSplashScreen()
        // 开启 edge-to-edge：让系统把 IME / 状态栏 / 导航栏 insets 派发给 Compose，
        // 这样 Scaffold + Modifier.imePadding() 才能正确处理键盘弹出时的输入框位置。
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // 配置变更(深色模式/语言/字号等，清单未声明 uiMode/locale)重建时，系统侧的 showWhenLocked 不会随实例重置，
        // 而来电意图已被消费、不会再设上标记：标记须随实例状态恢复，否则通话结束后撤不掉，锁屏照样泄露。
        showingOverLockscreen = savedInstanceState?.getBoolean(STATE_OVER_LOCKSCREEN) == true
        // 来电通过 fullScreenIntent 拉起本 Activity 时，若设备处于锁屏/熄屏，
        // 需主动点亮屏幕并越过锁屏展示来电界面，否则用户只看到黑屏/锁屏、看不到弹窗。
        if (needsLockscreenForIntent(intent)) enableShowOverLockscreen()
        handleCallIntent(intent)
        handleMessageIntent(intent)
        // CALL-2：越过锁屏只服务于通话页。处理完意图后若并没有进行中的通话（拒接、空推送等）立即复原，
        // 之后通话结束/收起小窗时也复原——此前设上后从不复原，来过一次电后聊天内容能在锁屏上直接看到。
        syncShowOverLockscreen()
        observeCallsForLockscreen()
        setContent {
            // 主题：由 VxinTheme 内部读取本地外观偏好（不在 Activity 根注入/收集 Flow，
            // 与 1.0.14 的启动路径保持一致，杜绝启动期换肤相关的崩溃风险）。
            VxinThemeWithPref {
                // 让 Compose testTag 暴露为 UiAutomator 的 resource-id（Appium 定位前提）
                Surface(modifier = Modifier
                    .fillMaxSize()
                    .semantics { testTagsAsResourceId = true }) {
                    AppNavigation()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // 通话中切后台时若保活前台服务没能起来（系统后台启动限制），回到前台立即补起，
        // 之后再切后台麦克风不再被系统静音
        callManager.onAppForeground()
        groupCallManager.onAppForeground()
        // 兜底：通话已结束却仍越过锁屏时复原（正常由 observeCallsForLockscreen 处理）
        syncShowOverLockscreen()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(STATE_OVER_LOCKSCREEN, showingOverLockscreen)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (needsLockscreenForIntent(intent)) enableShowOverLockscreen()
        handleCallIntent(intent)
        handleMessageIntent(intent)
        syncShowOverLockscreen()
    }

    /**
     * 来电意图是否需要越过锁屏展示来电界面。拒绝不需要：新版通知的「拒绝」已改走
     * [CallDeclineReceiver]，这里只剩旧版本遗留的通知意图，直接拒接即可，不点亮也不越过锁屏。
     */
    private fun needsLockscreenForIntent(intent: Intent?): Boolean =
        isCallIntent(intent) && intent?.action != NotificationHelper.ACTION_CALL_DECLINE &&
            notificationHelper.acceptsRecipient(intent?.getStringExtra(NotificationHelper.EXTRA_RECIPIENT_ID))

    /** 通话页是否仍需越过锁屏：1v1 进行中(含响铃)且未收起成小窗，或群通话进行中 */
    private fun callNeedsLockscreen(): Boolean {
        val call = callManager.state.value
        val callActive = call.stage != CallStage.IDLE && call.stage != CallStage.ENDED
        val groupStage = groupCallManager.state.value.stage
        val groupActive = groupStage != GroupCallStage.IDLE && groupStage != GroupCallStage.ENDED
        return (callActive && !call.isMinimized) || groupActive
    }

    /** 不再需要时撤掉越过锁屏/亮屏（幂等）。每次都读当前状态，不依赖某次推送的快照，避免迟到的旧状态误判。 */
    private fun syncShowOverLockscreen() {
        if (!callNeedsLockscreen()) disableShowOverLockscreen()
    }

    /**
     * 观察 1v1 与群通话状态：回到空闲/结束、或收起成小窗(露出会话列表/聊天页)时撤掉越过锁屏。
     * 不用 repeatOnLifecycle：熄屏/切后台(STOPPED)期间通话结束也要立即复原，否则下次亮屏仍越过锁屏。
     * lifecycleScope 在主线程执行，Activity 销毁时自动取消。
     */
    private fun observeCallsForLockscreen() {
        lifecycleScope.launch {
            combine(callManager.state, groupCallManager.state) { _, _ -> }.collect { syncShowOverLockscreen() }
        }
    }

    private fun isCallIntent(intent: Intent?): Boolean = when (intent?.action) {
        NotificationHelper.ACTION_CALL_SHOW,
        NotificationHelper.ACTION_CALL_ACCEPT,
        NotificationHelper.ACTION_CALL_DECLINE -> true
        // 个推厂商通道来电通知点击：action=MAIN 但带 callId extra（后端 pushCallToCid 的
        // intent:  S.callId/S.callFrom/S.callerName/S.callType）→ 同样视为来电意图，
        // 重建来电界面（App 被杀场景兜底）。无 callId 的普通消息点击不受影响。
        else -> intent?.getStringExtra(NotificationHelper.EXTRA_CALL_ID) != null
    }

    /**
     * 越过锁屏 + 点亮屏幕展示来电界面。
     * Android 8.1(27)+ 用 setShowWhenLocked/setTurnScreenOn；旧版用 window flags。
     * CALL-2：响铃时不再请求解锁（requestDismissKeyguard / FLAG_DISMISS_KEYGUARD）——有锁屏密码时
     * 解锁界面会先弹出盖住来电页。接听后要收起小窗离开通话页时才请求解锁（见 CallScreen.minimizeCall）；
     * 通话结束则由 [disableShowOverLockscreen] 复原，系统锁屏盖回，用户正常解锁后继续使用 App。
     */
    private fun enableShowOverLockscreen() {
        showingOverLockscreen = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
    }

    /** 撤掉 [enableShowOverLockscreen] 设上的越过锁屏/亮屏（未设过则不动）。旧系统清掉对应窗口标志。 */
    private fun disableShowOverLockscreen() {
        if (!showingOverLockscreen) return
        showingOverLockscreen = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(false)
            setTurnScreenOn(false)
        } else {
            @Suppress("DEPRECATION")
            window.clearFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
    }

    /**
     * 处理来电通知拉起的意图：进入 INCOMING 显示来电界面（CallHost 观察 CallManager.state 渲染）。
     * 接听/拒绝动作直接驱动 CallManager；信令走已有 socket（确保已重连）。
     */
    private fun handleCallIntent(intent: Intent?) {
        val action = intent?.action ?: return
        val isCallAction = action == NotificationHelper.ACTION_CALL_SHOW ||
            action == NotificationHelper.ACTION_CALL_ACCEPT ||
            action == NotificationHelper.ACTION_CALL_DECLINE
        // 厂商通道点击(action=MAIN + callId extra)同样放行,走 else 分支进入来电界面
        val hasCallIdExtra = intent.getStringExtra(NotificationHelper.EXTRA_CALL_ID) != null
        if (!isCallAction && !hasCallIdExtra) return
        if (!notificationHelper.acceptsRecipient(intent.getStringExtra(NotificationHelper.EXTRA_RECIPIENT_ID))) return

        val from = intent.getStringExtra(NotificationHelper.EXTRA_CALL_FROM).orEmpty()
        val callType = intent.getStringExtra(NotificationHelper.EXTRA_CALL_TYPE) ?: "audio"
        val callerName = intent.getStringExtra(NotificationHelper.EXTRA_CALL_NAME).orEmpty()
        val callId = intent.getStringExtra(NotificationHelper.EXTRA_CALL_ID).orEmpty()
        notificationHelper.cancelCallNotification()
        // 后台被唤醒时 socket 可能已断，接听/拒绝的信令需要它 → 先确保连接
        socketManager.connect()

        when (action) {
            NotificationHelper.ACTION_CALL_DECLINE -> {
                // 新版通知的「拒绝」走 CallDeclineReceiver；这里只兜底旧版本遗留的通知意图，拒接逻辑共用
                CallDeclineReceiver.rejectFromNotification(callManager, from, callType, callerName, callId)
            }
            else -> {
                // SHOW / ACCEPT 均只进入来电界面（INCOMING）。
                // 不在此直接 accept()：接听需麦克风/摄像头运行时权限，由 CallHost 挂载后统一申请再建连，
                // 避免冷启动权限未授予就 createLocalTracks。用户在来电界面点「接听」走正常权限流。
                callManager.incomingFromPush(from, callType, callerName, callId)
            }
        }
        // 消费掉，避免旋转/重建时重复触发
        intent.action = null
        intent.removeExtra(NotificationHelper.EXTRA_CALL_ID)
    }

    /**
     * 处理消息通知点击拉起的意图：只带 EXTRA_CONVERSATION_ID、无 call action。
     * 冷启动时 navController 未组合完成，这里不能直接 navigate，写入 PendingConversationHolder，
     * 由 AppNavigation 的 LaunchedEffect 监听并在 navController 就绪后再跳转
     * （未登录/会话过期时会先停在登录页，holder 里的值等登录成功进入 MainFlow 后仍会被消费）。
     */
    private fun handleMessageIntent(intent: Intent?) {
        if (isCallIntent(intent)) return
        val convId = intent?.getStringExtra(NotificationHelper.EXTRA_CONVERSATION_ID) ?: return
        if (!notificationHelper.acceptsRecipient(intent.getStringExtra(NotificationHelper.EXTRA_RECIPIENT_ID))) return
        // MainActivity exported=true，任意外部 App 可显式 startActivity 附带任意字符串。
        // conversationId 后续会拼进 Compose 路由 path 段并作为后端会话查询参数，格式校验兜底：
        // 真正的越权访问在后端 requireMember() 已挡住（非会话成员 403），这里只防路由畸形值
        // 撑爆路由解析 / 打断导航（isLetterOrDigit 也放行 CJK 全角字符，非严格 uuid 字符集校验，
        // 真实 id 为 uuidv4，见 conversations.service.js，此处只做粗粒度长度/字符防御）。
        if (!isValidConversationId(convId)) return
        PendingConversationHolder.conversationId.value = convId
        // 消费掉，避免旋转/重建时重复触发
        intent.removeExtra(NotificationHelper.EXTRA_CONVERSATION_ID)
    }

    private fun isValidConversationId(id: String): Boolean =
        id.isNotBlank() && id.length <= 64 && id.all { it.isLetterOrDigit() || it == '-' || it == '_' }

    private companion object {
        const val STATE_OVER_LOCKSCREEN = "touliao:showingOverLockscreen"
    }
}
