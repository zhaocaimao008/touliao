package com.touliao.app.review

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.espresso.Espresso
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.touliao.app.core.call.GroupCallManager
import com.touliao.app.core.call.GroupCallStage
import com.touliao.app.core.call.GroupCallState
import com.touliao.app.feature.call.GroupCallHost
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
 * CALL-11：群通话可以收起成小窗，点小窗恢复全屏；返回键在通话中只收起、绝不挂断。
 * 写法同 CallMinimizedBubbleTest：测试宿主 UiReviewActivity + 反射注入通话状态，不改 GroupCallManager 生产代码。
 * GroupCallHost() 无参调用走内联模式（全屏和小窗在同一个组合里）。
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class GroupCallMinimizeTest {
    @get:Rule(order = 0) val hilt = HiltAndroidRule(this)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<UiReviewActivity>()
    @get:Rule(order = 2) val permissions = androidx.test.rule.GrantPermissionRule.grant(android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.CAMERA, android.Manifest.permission.BLUETOOTH_CONNECT)

    @javax.inject.Inject lateinit var server: com.touliao.app.core.storage.ServerConfig
    @javax.inject.Inject lateinit var groupCallManager: GroupCallManager
    private lateinit var groupState: MutableStateFlow<GroupCallState>

    @Before fun setup() {
        hilt.inject()
        server.baseUrl = "https://native-review.invalid"
        // 仅测试用的状态注入：不走信令，GroupCallManager 生产代码不变
        val field = groupCallManager.javaClass.getDeclaredField("_state").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        groupState = field.get(groupCallManager) as MutableStateFlow<GroupCallState>
        groupState.value = GroupCallState(
            stage = GroupCallStage.CONNECTED,
            callId = "review-call",
            conversationId = "review-group",
            participants = listOf("review-peer"),
            connectedAt = android.os.SystemClock.elapsedRealtime(),
        )
        compose.setContent { VxinTheme(darkTheme = true) { GroupCallHost() } }
    }

    @After fun cleanup() {
        compose.runOnIdle { groupState.value = GroupCallState() }
    }

    @Test fun minimizeRestoreAndBackNeverHangsUp() {
        compose.waitForIdle()
        // 1. 左上角"收起通话"按钮：收成小窗
        compose.onNodeWithContentDescription("收起通话").performClick()
        compose.waitForIdle()
        Assert.assertTrue(groupCallManager.state.value.isMinimized)

        // 2. 单纯点按小窗（不拖动）恢复全屏；自己 + 1 个成员 = 2 人
        compose.onNodeWithContentDescription("群通话中（2人），点按返回").assertIsDisplayed().performClick()
        compose.waitForIdle()
        Assert.assertFalse(groupCallManager.state.value.isMinimized)

        // 3. 返回键：收起而不是挂断。只按一次——小窗状态下没有 BackHandler，再按会把宿主关掉
        Espresso.pressBack()
        compose.waitForIdle()
        Assert.assertTrue(groupCallManager.state.value.isMinimized)
        Assert.assertEquals(GroupCallStage.CONNECTED, groupCallManager.state.value.stage)
    }
}
