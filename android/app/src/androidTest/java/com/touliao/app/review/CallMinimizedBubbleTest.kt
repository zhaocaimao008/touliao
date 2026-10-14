package com.touliao.app.review

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.call.CallState
import com.touliao.app.feature.call.CallHost
import com.touliao.app.ui.theme.VxinTheme
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.After
import org.junit.Assert
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * CALL-1：通话小窗单纯点一下就要恢复全屏（此前只靠拖动结束判定点击，点按毫无反应）。
 * 复用 NativeUIReviewTest 的测试宿主与通话状态注入方式，不改 CallManager 生产代码。
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class CallMinimizedBubbleTest {
    @get:Rule(order = 0) val hilt = HiltAndroidRule(this)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<UiReviewActivity>()
    @get:Rule(order = 2) val permissions = androidx.test.rule.GrantPermissionRule.grant(android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.CAMERA, android.Manifest.permission.BLUETOOTH_CONNECT)

    @javax.inject.Inject lateinit var server: com.touliao.app.core.storage.ServerConfig
    @javax.inject.Inject lateinit var callManager: CallManager
    private lateinit var callState: MutableStateFlow<CallState>

    @Before fun setup() {
        hilt.inject()
        server.baseUrl = "https://native-review.invalid"
        // Test-only fixture injection leaves CallManager production source and signaling untouched.
        val field = callManager.javaClass.getDeclaredField("_state").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        callState = field.get(callManager) as MutableStateFlow<CallState>
        compose.setContent { VxinTheme(darkTheme = true) { CallHost() } }
    }

    @After fun cleanup() {
        compose.runOnIdle { callState.value = CallState() }
    }

    @Test fun tappingMinimizedBubbleRestoresFullScreenCall() {
        compose.runOnIdle {
            callState.value = CallState(
                stage = CallStage.CONNECTED, peerId = "review-peer", peerName = "李明",
                connectedAt = android.os.SystemClock.elapsedRealtime(),
            )
        }
        compose.waitForIdle()
        // 收起按钮有读屏文字，点了收成小窗
        compose.onNodeWithContentDescription("收起通话").performClick()
        compose.waitForIdle()
        Assert.assertTrue(callManager.state.value.isMinimized)
        // 单纯点按小窗（不拖动）恢复全屏，挂断键重新可见
        compose.onNodeWithContentDescription("与李明通话中，点按返回").assertIsDisplayed().performClick()
        compose.waitForIdle()
        Assert.assertFalse(callManager.state.value.isMinimized)
        compose.onNodeWithContentDescription("挂断").assertExists()
    }
}
