package com.vxin.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import com.vxin.app.ui.theme.VxinTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var callManager: CallManager
    @Inject lateinit var socketManager: SocketManager
    @Inject lateinit var notificationHelper: NotificationHelper

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleCallIntent(intent)
        setContent {
            VxinTheme {
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
        handleCallIntent(intent)
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
