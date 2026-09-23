package com.touliao.app.review

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import com.touliao.app.ui.TouliaoButton
import com.touliao.app.ui.TouliaoButtonVariant
import com.touliao.app.ui.components.TouliaoField
import com.touliao.app.ui.components.EmptyState
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import com.touliao.app.feature.auth.*
import com.touliao.app.feature.chat.*
import com.touliao.app.feature.contacts.*
import com.touliao.app.feature.group.*
import com.touliao.app.feature.profile.*
import com.touliao.app.feature.settings.*
import com.touliao.app.feature.search.SearchScreen
import com.touliao.app.feature.sessions.SessionsScreen
import com.touliao.app.feature.wallet.WalletScreen
import com.touliao.app.feature.labels.FriendLabelsScreen
import com.touliao.app.feature.favorites.FavoritesScreen
import com.touliao.app.feature.moments.*
import com.touliao.app.ui.theme.VxinTheme
import org.junit.*
import org.junit.runner.RunWith
import java.io.File

@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class NativeUIReviewTest {
    @get:Rule(order = 0) val hilt = HiltAndroidRule(this)
    @get:Rule(order = 1) val compose = createAndroidComposeRule<UiReviewActivity>()
    @get:Rule(order = 2) val notifications = androidx.test.rule.GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS, android.Manifest.permission.RECORD_AUDIO, android.Manifest.permission.CAMERA, android.Manifest.permission.BLUETOOTH_CONNECT)
    private val screen = mutableStateOf("login")
    private val dark = mutableStateOf(false)
    private val large = mutableStateOf(false)
    private val output get() = File(compose.activity.getExternalFilesDir(null), "NativeUiReview").apply { mkdirs() }

    @javax.inject.Inject lateinit var server: com.touliao.app.core.storage.ServerConfig
    @javax.inject.Inject lateinit var token: com.touliao.app.core.storage.TokenStore
    @javax.inject.Inject lateinit var session: com.touliao.app.core.auth.SessionManager
    @javax.inject.Inject lateinit var socket: com.touliao.app.core.realtime.SocketManager

    @javax.inject.Inject lateinit var callManager: com.touliao.app.core.call.CallManager

    @After fun cleanup() { socket.disconnect(); token.token = null }

    @Before fun setup() {
        hilt.inject()
        server.baseUrl = "https://native-review.invalid"
        token.token = "native-ui-review-only"
        kotlinx.coroutines.runBlocking { session.restoreSession() }
        compose.setContent {
            VxinTheme(darkTheme = dark.value) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(if (large.value) compose.activity.resources.displayMetrics.widthPixels / 320f else density.density, if (large.value) 2f else 1f)) {
                    Surface(Modifier.fillMaxSize()) {
                        key(screen.value, dark.value, large.value) {
                            val nav = rememberNavController()
                            val id = if (screen.value in listOf("group", "invite-members", "group-qr")) "review-group" else "review-chat"
                            NavHost(nav, "review") {
                                composable("review", arguments = listOf(
                                    androidx.navigation.navArgument("conversationId") { defaultValue = id },
                                    androidx.navigation.navArgument("type") { defaultValue = if (id == "review-group") "group" else "private" },
                                    androidx.navigation.navArgument("title") { defaultValue = "李明" }
                                )) { ReviewScreen(screen.value) }
                            }
                        }
                    }
                }
            }
        }
    }

    @Test fun nativeScreenGallery() {
        val pages = listOf("login", "register", "forgot-password", "conversations", "chat", "files", "mentions",
            "contacts", "add-friend", "friend-requests", "create-group", "blocked", "friend-labels", "group", "invite-members",
            "search", "my-qr", "group-qr", "profile", "edit-profile", "settings", "appearance", "notifications", "privacy", "sessions", "call-history", "call-controls", "wallet",
            "favorites", "moments", "compose-moment", "invite-friend")
        for (night in listOf(false, true)) for (page in pages) {
            compose.runOnIdle { screen.value = page; dark.value = night; large.value = false }
            settle()
            if (page == "call-controls") compose.runOnIdle {
                val bars = androidx.core.view.WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView)
                Assert.assertFalse(bars.isAppearanceLightStatusBars)
                Assert.assertFalse(bars.isAppearanceLightNavigationBars)
            }
            if (page == "chat") compose.onAllNodesWithText("收到，稍后把文件发给你。", substring = true).onFirst().assertExists()
            if (page == "group") compose.onAllNodesWithText("投聊设计讨论", substring = true).onFirst().assertExists()
            snapshot(page + if (night) "-dark" else "-light")
        }
        for (page in listOf("login", "contacts", "chat", "settings", "appearance", "call-controls")) {
            compose.runOnIdle { screen.value = page; dark.value = true; large.value = true }
            settle(); snapshot(page + "-dark-large-text")
        }
        // Test-only fixture injection leaves CallManager production source and signaling untouched.
        val field = callManager.javaClass.getDeclaredField("_state").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val callState = field.get(callManager) as kotlinx.coroutines.flow.MutableStateFlow<com.touliao.app.core.call.CallState>
        try {
            for (video in listOf(false, true)) for (incoming in listOf(false, true)) {
                compose.runOnIdle {
                    callState.value = com.touliao.app.core.call.CallState(
                        stage = if (incoming) com.touliao.app.core.call.CallStage.INCOMING else com.touliao.app.core.call.CallStage.CONNECTED,
                        peerId = "review-peer", peerName = "李明", isVideo = video, bluetoothAvailable = true,
                        connectedAt = android.os.SystemClock.elapsedRealtime() - 65_000)
                    screen.value = "call-full"; dark.value = true; large.value = false
                }
                settle(); snapshot((if (video) "video-call" else "voice-call") + (if (incoming) "-incoming" else "-connected"))
            }
        } finally { compose.runOnIdle { callState.value = com.touliao.app.core.call.CallState(); screen.value = "login" } }
        File(output, "requests.txt").writeText(ReviewModule.requests.joinToString("\n"))
    }

    @Test fun p2ComponentStates() {
        for (night in listOf(false, true)) {
            compose.runOnIdle { screen.value = "p2-states"; dark.value = night; large.value = false }
            settle()
            compose.onNodeWithText("状态开关").assertIsOff().performClick().assertIsOn()
            compose.onNodeWithText("禁用开关").assertIsNotEnabled()
            compose.onNodeWithText("普通输入").performScrollTo()
            compose.onNodeWithText("禁用输入").assertExists()
            compose.onNodeWithText("普通输入").performClick()
            compose.onNodeWithText("普通输入").assertExists()
            snapshot("p2-component-states-" + if (night) "dark" else "light")
            androidx.test.espresso.Espresso.pressBack()
            compose.runOnIdle { screen.value = "p2-error" }
            settle(); compose.onNodeWithText("重试").assertIsEnabled()
            snapshot("p2-error-retry-" + if (night) "dark" else "light")
            compose.onNodeWithText("重试").performClick()
            compose.onNodeWithText("重试已触发").assertExists()
        }
        compose.runOnIdle { screen.value = "p2-states"; large.value = true }
        settle(); snapshot("p2-component-states-dark-large-text")
        compose.onNodeWithTag("p2-loading-button").performScrollTo()
        settle()
        compose.onNodeWithTag("p2-loading-button").assertIsDisplayed()
        val loadingBounds = compose.onNodeWithTag("p2-loading-button").getUnclippedBoundsInRoot()
        val rootBounds = compose.onRoot().getUnclippedBoundsInRoot()
        Assert.assertTrue("Entire loading button must be inside the native viewport", loadingBounds.bottom <= rootBounds.bottom)
        snapshot("p2-component-buttons-dark-large-text")
    }

    @Test fun loginFormKeyboardAndNavigation() {
        settle()
        compose.onNodeWithTag("login-submit-btn").assertIsNotEnabled()
        compose.onNodeWithTag("login-phone-input").performClick().performTextInput("13800000000")
        compose.onNodeWithTag("login-password-input").performScrollTo().performClick().performTextInput("ReviewOnly123")
        compose.onNodeWithTag("login-submit-btn").assertIsEnabled()
        compose.waitUntil(timeoutMillis = 8_000) {
            androidx.core.view.ViewCompat.getRootWindowInsets(compose.activity.window.decorView)
                ?.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) == true
        }
        settle()
        snapshot("login-keyboard")
        compose.onNodeWithTag("login-submit-btn").performScrollTo().assertIsDisplayed()
        settle()
        snapshot("login-keyboard-submit")
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithText("忘记密码").performScrollTo().performClick()
        settle()
        compose.onNodeWithText("密码重置服务暂时不可用").assertIsDisplayed()
        compose.onNodeWithText("返回登录").performScrollTo().performClick()
        settle()
        compose.onNodeWithTag("login-phone-input").assertExists()
        Assert.assertFalse(ReviewModule.requests.any { it.startsWith("POST /api/auth/login") })
    }

    @Test fun compactChatActionsRemainAvailable() {
        compose.runOnIdle { screen.value = "chat"; dark.value = true; large.value = true }
        settle()
        compose.onNodeWithContentDescription("聊天选项").performClick()
        for (label in listOf("搜索聊天记录", "语音通话", "视频通话", "聊天文件")) {
            compose.onNodeWithText(label).assertExists()
        }
        compose.onNodeWithText("聊天文件").performScrollTo().assertIsDisplayed()
        snapshot("chat-menu-dark-large-text")
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithText("搜索聊天记录").assertDoesNotExist()
        compose.onNodeWithTag("chat-msg-input").assertExists()
        for ((night, big, name) in listOf(Triple(false, false, "chat-attachments-light"),
            Triple(true, false, "chat-attachments-dark"), Triple(true, true, "chat-attachments-dark-large-text"))) {
            compose.runOnIdle { dark.value = night; large.value = big }
            settle()
            compose.onNodeWithTag("chat-more-btn").performClick()
            settle()
            for (label in listOf("图片", "视频", "文件")) compose.onNodeWithText(label).assertIsDisplayed()
            snapshot(name)
            compose.onNodeWithTag("chat-function-panel").performScrollToNode(hasText("定时列表"))
            compose.onNodeWithText("定时列表").assertIsDisplayed()
            compose.onNodeWithTag("chat-more-btn").performClick()
            compose.onNodeWithTag("chat-function-panel").assertDoesNotExist()
            compose.onNodeWithTag("chat-emoji-btn").performClick()
            settle(); snapshot(name.replace("attachments", "emoji"))
            compose.onNodeWithTag("chat-emoji-btn").performClick()
        }
        compose.runOnIdle { large.value = false }
        settle()
        compose.onAllNodesWithText("收到，稍后把文件发给你。", substring = true).onFirst().performTouchInput { longClick() }
        compose.onNodeWithText("复制").assertExists()
        snapshot("message-context-menu-dark")
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithTag("chat-more-btn").performClick()
        compose.onNodeWithText("文件").performClick()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val deadline = android.os.SystemClock.elapsedRealtime() + 10_000
        while (automation.rootInActiveWindow?.packageName?.toString()?.contains("documentsui") != true && android.os.SystemClock.elapsedRealtime() < deadline) {
            Thread.sleep(200)
        }
        val pickerPackage = automation.rootInActiveWindow?.packageName?.toString().orEmpty()
        Assert.assertTrue("Capture the system file picker, not the outgoing chat frame", pickerPackage.contains("documentsui"))
        automation.waitForIdle(500, 5_000)
        Thread.sleep(500)
        snapshot("native-file-picker-dark")
        File(output, "file-picker-validation.txt").writeText(pickerPackage)
        automation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
    }

    private fun settle() {
        compose.waitForIdle()
        // Native asynchronous repositories complete against in-process responses.
        Thread.sleep(700)
        compose.waitForIdle()
    }
    private fun snapshot(name: String) {
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        Assert.assertTrue(bitmap.width > 200)
    }
    @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
    @Composable private fun ReviewScreen(name: String) {
        val back = { screen.value = "login" }
        when (name) {
            "p2-states" -> Column(Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                var checked by remember { mutableStateOf(false) }
                com.touliao.app.ui.components.TouliaoSettingToggle("状态开关", checked = checked, onChange = { checked = it })
                com.touliao.app.ui.components.TouliaoSettingToggle("禁用开关", checked = false, enabled = false, onChange = {})
                var value by remember { mutableStateOf("") }
                TouliaoField(value, { value = it }, label = { Text("普通输入") })
                TouliaoField("中文文件名", {}, label = { Text("错误输入") }, isError = true, supportingText = { Text("请检查输入内容") })
                TouliaoField("不可编辑", {}, label = { Text("禁用输入") }, enabled = false)
                TouliaoButton("确认", {})
                TouliaoButton("取消", {}, variant = TouliaoButtonVariant.SECONDARY)
                TouliaoButton("删除", {}, variant = TouliaoButtonVariant.DANGER)
                TouliaoButton("禁用", {}, enabled = false)
                TouliaoButton("加载中", {}, loading = true, modifier = Modifier.testTag("p2-loading-button"))
            }
            "p2-error" -> {
                var retried by remember { mutableStateOf(false) }
                EmptyState(icon = com.touliao.app.ui.TouliaoIcons.Warning,
                    title = if (retried) "重试已触发" else "文件加载失败",
                    subtitle = "中文长文件名与未知格式文件，网络恢复后可以重试", isError = true,
                    actionLabel = "重试", onAction = { retried = true })
            }
            "login" -> LoginScreen(onNavigateRegister = { screen.value = "register" }, onNavigateForgotPassword = { screen.value = "forgot-password" })
            "register" -> RegisterScreen(onBack = back)
            "forgot-password" -> ForgotPasswordScreen(onBack = back)
            "conversations" -> ConversationListScreen(onOpenConversation = {})
            "chat" -> ChatScreen(onBack = back)
            "files" -> ConversationFilesScreen(onBack = back)
            "mentions" -> MentionsScreen(onBack = back, onOpenConversation = { _, _ -> })
            "contacts" -> ContactsScreen(onOpenChat = {}, onAddFriend = {}, onRequests = {}, onCreateGroup = {})
            "add-friend" -> AddFriendScreen(onBack = back)
            "friend-requests" -> FriendRequestsScreen(onBack = back)
            "create-group" -> CreateGroupScreen(onBack = back, onCreated = {})
            "blocked" -> BlockedScreen(onBack = back)
            "friend-labels" -> FriendLabelsScreen(onBack = back)
            "group" -> GroupInfoScreen(onBack = back, onInvite = {}, onLeft = {})
            "invite-members" -> InviteMembersScreen(onBack = back, onDone = {})
            "search" -> SearchScreen(onBack = back, onOpenResult = {})
            "my-qr" -> MyQrCodeScreen(onBack = back)
            "group-qr" -> GroupQrScreen(onBack = back)
            "profile" -> ProfileScreen()
            "edit-profile" -> ProfileEditScreen(onBack = back)
            "settings" -> SettingsHomeScreen(onBack = back, onOpenNotifications = {}, onOpenPrivacy = {}, onOpenAppearance = {}, onOpenSessions = {})
            "appearance" -> AppearanceSettingsScreen(onBack = back)
            "notifications" -> NotificationSettingsScreen(onBack = back)
            "privacy" -> PrivacySettingsScreen(onBack = back)
            "sessions" -> SessionsScreen(onBack = back)
            "call-full" -> com.touliao.app.feature.call.CallHost()
            "call-controls" -> Surface(Modifier.fillMaxSize(), color = com.touliao.app.ui.theme.TouliaoDarkPalette.background) {
                com.touliao.app.ui.components.DarkMediaSystemBars()
                Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.Center) {
                    FlowRow(Modifier.fillMaxWidth(), maxItemsInEachRow = 3,
                        horizontalArrangement = Arrangement.spacedBy(16.dp, androidx.compose.ui.Alignment.CenterHorizontally),
                        verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        for (label in listOf("麦克风开", "麦克风关", "扬声器关", "扬声器开", "蓝牙开", "蓝牙关", "挂断", "摄像头关", "翻转")) {
                            com.touliao.app.ui.components.CallActionButton(label,
                                if (label == "挂断") com.touliao.app.ui.theme.TouliaoLightPalette.readableDanger else com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) {}
                        }
                    }
                }
            }
            "call-history" -> com.touliao.app.feature.callhistory.CallHistoryScreen(onBack = back)
            "wallet" -> WalletScreen(onBack = back)
            "favorites" -> FavoritesScreen(onBack = back)
            "moments" -> MomentsScreen(onBack = back)
            "compose-moment" -> MomentComposeScreen(onBack = back, onPublished = {})
            "invite-friend" -> InviteFriendScreen(onBack = back)
        }
    }
}
