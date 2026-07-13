package com.vxin.app

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.vxin.app.core.call.CallManager
import com.vxin.app.core.push.NotificationHelper
import com.vxin.app.core.realtime.SocketManager
import com.vxin.app.navigation.AppNavigation
import com.vxin.app.ui.theme.VxinThemeWithPref
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var callManager: CallManager
    @Inject lateinit var socketManager: SocketManager
    @Inject lateinit var notificationHelper: NotificationHelper

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        // 开启 edge-to-edge：让系统把 IME / 状态栏 / 导航栏 insets 派发给 Compose，
        // 这样 Scaffold + Modifier.imePadding() 才能正确处理键盘弹出时的输入框位置。
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // 来电通过 fullScreenIntent 拉起本 Activity 时，若设备处于锁屏/熄屏，
        // 需主动点亮屏幕并越过锁屏展示来电界面，否则用户只看到黑屏/锁屏、看不到弹窗。
        if (isCallIntent(intent)) enableShowOverLockscreen()
        handleCallIntent(intent)
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (isCallIntent(intent)) enableShowOverLockscreen()
        handleCallIntent(intent)
    }

    private fun isCallIntent(intent: Intent?): Boolean = when (intent?.action) {
        NotificationHelper.ACTION_CALL_SHOW,
        NotificationHelper.ACTION_CALL_ACCEPT,
        NotificationHelper.ACTION_CALL_DECLINE -> true
        else -> false
    }

    /**
     * 越过锁屏 + 点亮屏幕展示来电界面。
     * Android 8.1(27)+ 用 setShowWhenLocked/setTurnScreenOn；旧版用 window flags。
     * 并请求 KeyguardManager 关闭键盘锁（无密码锁屏可直接进入，有密码锁屏则接听后引导解锁）。
     */
    private fun enableShowOverLockscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
                ?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
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
        if (action != NotificationHelper.ACTION_CALL_SHOW &&
            action != NotificationHelper.ACTION_CALL_ACCEPT &&
            action != NotificationHelper.ACTION_CALL_DECLINE
        ) return

        val from = intent.getStringExtra(NotificationHelper.EXTRA_CALL_FROM).orEmpty()
        val callType = intent.getStringExtra(NotificationHelper.EXTRA_CALL_TYPE) ?: "audio"
        val callerName = intent.getStringExtra(NotificationHelper.EXTRA_CALL_NAME).orEmpty()
        notificationHelper.cancelCallNotification()
        // 后台被唤醒时 socket 可能已断，接听/拒绝的信令需要它 → 先确保连接
        socketManager.connect()

        when (action) {
            NotificationHelper.ACTION_CALL_DECLINE -> {
                callManager.incomingFromPush(from, callType, callerName)
                callManager.reject()
            }
            else -> {
                // SHOW / ACCEPT 均只进入来电界面（INCOMING）。
                // 不在此直接 accept()：接听需麦克风/摄像头运行时权限，由 CallHost 挂载后统一申请再建连，
                // 避免冷启动权限未授予就 createLocalTracks。用户在来电界面点「接听」走正常权限流。
                callManager.incomingFromPush(from, callType, callerName)
            }
        }
        // 消费掉，避免旋转/重建时重复触发
        intent.action = null
    }
}
