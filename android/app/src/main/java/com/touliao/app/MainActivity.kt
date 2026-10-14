package com.touliao.app

import android.content.Intent
import android.os.Bundle
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallUiPresence
import com.touliao.app.core.call.CallUiRules
import com.touliao.app.core.call.GroupCallManager
import com.touliao.app.core.push.CallActionReceiver
import com.touliao.app.core.push.NotificationHelper
import com.touliao.app.core.realtime.SocketManager
import com.touliao.app.feature.call.CallActivity
import com.touliao.app.navigation.AppNavigation
import com.touliao.app.navigation.PendingConversationHolder
import com.touliao.app.ui.theme.VxinThemeWithPref
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 启动入口与主界面（会话列表、聊天等）。
 *
 * CALL-2：本 Activity 在清单和代码里都永远不能越过锁屏显示，也不点亮屏幕——锁屏时它只会被系统锁屏盖住，
 * 聊天内容不会泄露。来电页、通话页等全屏通话界面一律由独立任务里的 [CallActivity] 负责；
 * 这里只渲染应用内通话小窗和群邀请横幅（AppNavigation 里的 CallOverlay），
 * 并在自己可见时按 [CallUiRules.mainShouldOpenCallUi] 自动拉起 [CallActivity]。
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var callManager: CallManager
    @Inject lateinit var groupCallManager: GroupCallManager
    @Inject lateinit var socketManager: SocketManager
    @Inject lateinit var notificationHelper: NotificationHelper

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        // SplashScreen API：冷启动显示品牌启动屏，深浅两套窗口背景避免闪白/闪黑
        installSplashScreen()
        // 开启 edge-to-edge：让系统把 IME / 状态栏 / 导航栏 insets 派发给 Compose，
        // 这样 Scaffold + Modifier.imePadding() 才能正确处理键盘弹出时的输入框位置。
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handleCallIntent(intent)
        handleMessageIntent(intent)
        observeCallUi()
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

    override fun onStart() {
        super.onStart()
        // 主界面在场标记：群邀请据此决定弹横幅还是发通知
        CallUiPresence.setMainUiStarted(true)
    }

    override fun onStop() {
        super.onStop()
        // 配置变更引起的 onStop 不写 false：新实例紧接着 onStart，中间不应被当成"主界面不可见"
        if (!isChangingConfigurations) CallUiPresence.setMainUiStarted(false)
    }

    override fun onResume() {
        super.onResume()
        // 通话中切后台时若保活前台服务没能起来（系统后台启动限制），回到前台立即补起，
        // 之后再切后台麦克风不再被系统静音
        callManager.onAppForeground()
        groupCallManager.onAppForeground()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCallIntent(intent)
        handleMessageIntent(intent)
    }

    /**
     * 自己可见（STARTED）时自动拉起通话页：来电响铃、1v1 结束页、未收起的 1v1 / 群通话，
     * 且通话页当前不在前台（规则见 [CallUiRules.mainShouldOpenCallUi]）。
     * 覆盖前台收到来电、发起通话、从横幅加入群通话、收起状态下通话结束（显示结束页），
     * 以及在通话页按 Home 后再从图标打开 App（回到全屏通话页）。
     * 经 distinctUntilChanged 只在结果由假变真时拉起一次；每次重新 STARTED 会重新判断。
     */
    private fun observeCallUi() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                combine(callManager.state, groupCallManager.state, CallUiPresence.callUiStarted) { c, g, s ->
                    CallUiRules.mainShouldOpenCallUi(c, g, s)
                }.distinctUntilChanged().collect { shouldOpen ->
                    if (shouldOpen) CallActivity.open(this@MainActivity)
                }
            }
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
     * 处理旧版通知 / 个推厂商通道点击拉起本 Activity 的来电意图（新版来电通知直接指向 [CallActivity]）。
     * 这里只驱动 CallManager 进入来电状态，来电页由 [observeCallUi] 拉起 [CallActivity] 显示；
     * 本 Activity 自己不显示来电页，所以锁屏时用户要先解锁才会看到（放弃越过锁屏后接受的取舍）。
     * 信令走已有 socket（确保已重连）。
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
        // 后台被唤醒时 socket 可能已断，接听/拒绝的信令需要它 → 先确保连接
        socketManager.connect()

        when (action) {
            NotificationHelper.ACTION_CALL_DECLINE -> {
                // 新版通知的「拒绝」走 CallActionReceiver 广播；这里只兜底旧版本遗留的通知意图，拒接逻辑共用
                notificationHelper.cancelCallNotification()
                CallActionReceiver.rejectFromNotification(callManager, from, callType, callerName, callId)
            }
            else -> {
                // SHOW / ACCEPT / 厂商通道点击均只进入来电状态（INCOMING），不收起来电通知、也不在此接听：
                // 来电通知由 CallManager.accept() / cleanup() 收起；接听需麦克风/摄像头运行时权限，
                // 由通话页统一申请后再由用户点「接听」。
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
}
