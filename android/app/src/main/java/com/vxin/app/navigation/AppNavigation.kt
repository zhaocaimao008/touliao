package com.vxin.app.navigation

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.vxin.app.core.auth.AuthState
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.update.UpdateChecker
import com.vxin.app.feature.auth.ForgotPasswordScreen
import com.vxin.app.feature.auth.LoginScreen
import com.vxin.app.feature.auth.RegisterScreen
import com.vxin.app.feature.call.CallHost
import com.vxin.app.feature.chat.ChatScreen
import com.vxin.app.feature.chat.ConversationListScreen
import com.vxin.app.feature.contacts.AddFriendScreen
import com.vxin.app.feature.contacts.BlockedScreen
import com.vxin.app.feature.contacts.ContactsScreen
import com.vxin.app.feature.contacts.CreateGroupScreen
import com.vxin.app.feature.contacts.FriendRequestsScreen
import com.vxin.app.feature.group.GroupInfoScreen
import com.vxin.app.feature.group.GroupQrScreen
import com.vxin.app.feature.group.InviteMembersScreen
import com.vxin.app.feature.profile.MyQrCodeScreen
import com.vxin.app.feature.profile.ProfileScreen
import com.vxin.app.feature.search.SearchScreen
import com.vxin.app.ui.VxinIcons
import com.vxin.app.data.api.ConfigApi
import com.vxin.app.data.repository.ChatRepository
import com.vxin.app.data.model.Features
import dagger.hilt.android.lifecycle.HiltViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AppViewModel @Inject constructor(
    sessionManager: SessionManager,
    private val configApi: ConfigApi,
    private val chatRepository: ChatRepository,
    private val updateChecker: UpdateChecker,
) : ViewModel() {
    val authState: StateFlow<AuthState> = sessionManager.state

    // 后台功能开关（朋友圈/收藏）。默认全开，拉取失败不误伤已有功能。
    private val _features = MutableStateFlow(Features())
    val features: StateFlow<Features> = _features.asStateFlow()

    // 底部「消息」tab 未读总数（用于红点角标）
    private val _unreadTotal = MutableStateFlow(0)
    val unreadTotal: StateFlow<Int> = _unreadTotal.asStateFlow()

    init {
        viewModelScope.launch {
            runCatching { configApi.getConfig() }.onSuccess { _features.value = it.features }
        }
        // 首次加载 + 实时事件驱动刷新未读总数
        refreshUnread()
        viewModelScope.launch { chatRepository.incomingMessages.collect { refreshUnread() } }
        viewModelScope.launch { chatRepository.unreadClearedEvents.collect { refreshUnread() } }
        viewModelScope.launch { chatRepository.newConversationEvents.collect { refreshUnread() } }

        // 启动时静默检查更新（仅打印日志，不干扰启动流程）
        viewModelScope.launch { updateChecker.check() }
    }

    fun refreshUnread() {
        viewModelScope.launch {
            runCatching { chatRepository.loadConversations() }
                // 免打扰会话不计入数字角标(对齐微信,免打扰只在会话内显示小红点)
                .onSuccess { list -> _unreadTotal.value = list.filter { it.muted != 1 }.sumOf { it.unreadCount } }
        }
    }
}

private object Routes {
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val FORGOT_PASSWORD = "forgotPassword"
    const val CONVERSATIONS = "conversations"
    const val PROFILE = "profile"
    const val CONTACTS = "contacts"
    const val ADD_FRIEND = "addFriend"
    const val MY_QRCODE = "myQrCode"
    const val BLOCKED = "blocked"
    const val FAVORITES = "favorites"
    const val WALLET = "wallet"
    const val SESSIONS = "sessions"
    const val FRIEND_LABELS = "friendLabels"
    const val PRIVACY = "privacySettings"
    const val NOTIFICATIONS = "notificationSettings"
    const val APPEARANCE = "appearanceSettings"
    const val CALL_HISTORY = "callHistory"
    const val MOMENTS = "moments"
    const val MOMENT_COMPOSE = "momentCompose"
    const val REQUESTS = "requests"
    const val CREATE_GROUP = "createGroup"
    const val SEARCH = "search"
    const val ADD_ACCOUNT = "addAccount"
    const val GROUP_INFO = "groupInfo/{conversationId}"
    const val GROUP_QR = "groupQr/{conversationId}"
    const val INVITE_MEMBERS = "inviteMembers/{conversationId}"
    const val CHAT = "chat/{conversationId}?title={title}&type={type}&peerUserId={peerUserId}"
    fun chat(conversationId: String, title: String, type: String, peerUserId: String = "") =
        "chat/$conversationId?title=${Uri.encode(title)}&type=$type&peerUserId=${Uri.encode(peerUserId)}"
    fun groupInfo(conversationId: String) = "groupInfo/$conversationId"
    fun groupQr(conversationId: String) = "groupQr/$conversationId"
    fun inviteMembers(conversationId: String) = "inviteMembers/$conversationId"
}

@Composable
fun AppNavigation(appViewModel: AppViewModel = hiltViewModel()) {
    val authState by appViewModel.authState.collectAsStateWithLifecycle()
    val features by appViewModel.features.collectAsStateWithLifecycle()
    val unreadTotal by appViewModel.unreadTotal.collectAsStateWithLifecycle()

    when (authState) {
        is AuthState.Loading -> SplashScreen()
        is AuthState.Authenticated -> MainFlow(features, unreadTotal)
        is AuthState.Unauthenticated -> AuthFlow()
    }
}

@Composable
private fun AuthFlow() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.LOGIN) {
        composable(Routes.LOGIN) {
            LoginScreen(
                onNavigateRegister = { navController.navigate(Routes.REGISTER) },
                onNavigateForgotPassword = { navController.navigate(Routes.FORGOT_PASSWORD) },
            )
        }
        composable(Routes.REGISTER) {
            RegisterScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.FORGOT_PASSWORD) {
            ForgotPasswordScreen(onBack = { navController.popBackStack() })
        }
    }
}

private data class TabItem(val route: String, val label: String, val icon: ImageVector, val testKey: String)

// 底部导航：仅保留 消息 / 通讯录 / 我（已按需移除 朋友圈 与 收藏）
// 图标改用自绘品牌图标集 VxinIcons（取代 Material 通用图标）
private val TAB_ITEMS = listOf(
    TabItem(Routes.CONVERSATIONS, "消息", VxinIcons.Chat, "chats"),
    TabItem(Routes.CONTACTS, "通讯录", VxinIcons.Contacts, "contacts"),
    TabItem(Routes.PROFILE, "我", VxinIcons.Me, "me"),
)
private val TAB_ROUTES = TAB_ITEMS.map { it.route }.toSet()

@Composable
private fun MainFlow(features: Features, unreadTotal: Int = 0) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // 底部 tab 已固定为 消息/通讯录/我，无需再按 features 开关过滤
    val visibleTabs = TAB_ITEMS

    Box(Modifier.fillMaxSize()) {
    Scaffold(
        bottomBar = {
            if (currentRoute in TAB_ROUTES) {
                NavigationBar {
                    visibleTabs.forEach { tab ->
                        NavigationBarItem(
                            modifier = Modifier.testTag("nav-tab-${tab.testKey}"),
                            selected = currentRoute == tab.route,
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                // 「消息」tab 显示未读总数红点角标
                                if (tab.route == Routes.CONVERSATIONS && unreadTotal > 0) {
                                    BadgedBox(badge = { Badge { Text(if (unreadTotal > 99) "99+" else unreadTotal.toString()) } }) {
                                        Icon(tab.icon, contentDescription = tab.label)
                                    }
                                } else {
                                    Icon(tab.icon, contentDescription = tab.label)
                                }
                            },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Routes.CONVERSATIONS,
            modifier = Modifier.padding(padding),
        ) {
            composable(Routes.CONVERSATIONS) {
                ConversationListScreen(
                    onOpenConversation = { conv -> navController.navigate(Routes.chat(conv.id, conv.name, conv.type, conv.otherUser?.id.orEmpty())) },
                    onOpenSearch = { navController.navigate(Routes.SEARCH) },
                )
            }
            composable(Routes.SEARCH) {
                SearchScreen(
                    onBack = { navController.popBackStack() },
                    onOpenResult = { r -> navController.navigate(Routes.chat(r.conversation_id, r.convName, r.convType, r.otherUser?.id.orEmpty())) },
                )
            }
            composable(Routes.CONTACTS) {
                ContactsScreen(
                    onOpenChat = { target -> navController.navigate(Routes.chat(target.conversationId, target.title, "private", target.peerUserId)) },
                    onAddFriend = { navController.navigate(Routes.ADD_FRIEND) },
                    onRequests = { navController.navigate(Routes.REQUESTS) },
                    onCreateGroup = { navController.navigate(Routes.CREATE_GROUP) },
                    onOpenBlocked = { navController.navigate(Routes.BLOCKED) },
                    onOpenLabels = { navController.navigate(Routes.FRIEND_LABELS) },
                )
            }
            composable(Routes.FRIEND_LABELS) {
                com.vxin.app.feature.labels.FriendLabelsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.PROFILE) {
                ProfileScreen(
                    onAddAccount = { navController.navigate(Routes.ADD_ACCOUNT) },
                    onOpenMyQr = { navController.navigate(Routes.MY_QRCODE) },
                    onOpenCallHistory = { navController.navigate(Routes.CALL_HISTORY) },
                    onOpenWallet = { navController.navigate(Routes.WALLET) },
                    onOpenSessions = { navController.navigate(Routes.SESSIONS) },
                    onOpenPrivacy = { navController.navigate(Routes.PRIVACY) },
                    onOpenNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
                    onOpenAppearance = { navController.navigate(Routes.APPEARANCE) },
                )
            }
            composable(Routes.WALLET) {
                com.vxin.app.feature.wallet.WalletScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.SESSIONS) {
                com.vxin.app.feature.sessions.SessionsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.PRIVACY) {
                com.vxin.app.feature.settings.PrivacySettingsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.NOTIFICATIONS) {
                com.vxin.app.feature.settings.NotificationSettingsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.APPEARANCE) {
                com.vxin.app.feature.settings.AppearanceSettingsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.CALL_HISTORY) {
                com.vxin.app.feature.callhistory.CallHistoryScreen(
                    onBack = { navController.popBackStack() },
                    onOpenChat = { target -> navController.navigate(Routes.chat(target.conversationId, target.title, "private", target.peerUserId)) },
                )
            }
            // 朋友圈 / 收藏 已按需移除（不再注册路由与入口）
            composable(Routes.ADD_ACCOUNT) {
                LoginScreen(
                    onNavigateRegister = { navController.navigate(Routes.REGISTER) },
                    onSuccess = { navController.popBackStack() },
                )
            }
            composable(Routes.ADD_FRIEND) {
            AddFriendScreen(
                onBack = { navController.popBackStack() },
                onOpenMyQr = { navController.navigate(Routes.MY_QRCODE) },
            )
        }
        composable(Routes.MY_QRCODE) {
            MyQrCodeScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.BLOCKED) {
            BlockedScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.REQUESTS) {
            FriendRequestsScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.CREATE_GROUP) {
            CreateGroupScreen(
                onBack = { navController.popBackStack() },
                onCreated = { target ->
                    // 创建成功后回到会话列表再进入群聊（避免返回栈停在创建页）
                    navController.popBackStack(Routes.CONVERSATIONS, inclusive = false)
                    navController.navigate(Routes.chat(target.conversationId, target.title, "group"))
                },
            )
        }
        composable(
            route = Routes.CHAT,
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("title") { type = NavType.StringType; defaultValue = "" },
                navArgument("type") { type = NavType.StringType; defaultValue = "private" },
                navArgument("peerUserId") { type = NavType.StringType; defaultValue = "" },
            ),
        ) {
            ChatScreen(
                onBack = { navController.popBackStack() },
                onOpenGroupInfo = { convId -> navController.navigate(Routes.groupInfo(convId)) },
            )
        }
        composable(
            route = Routes.GROUP_INFO,
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
        ) {
            GroupInfoScreen(
                onBack = { navController.popBackStack() },
                onInvite = { convId -> navController.navigate(Routes.inviteMembers(convId)) },
                onOpenQr = { convId -> navController.navigate(Routes.groupQr(convId)) },
                onLeft = { navController.popBackStack(Routes.CONVERSATIONS, inclusive = false) },
            )
        }
        composable(
            route = Routes.GROUP_QR,
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
        ) {
            GroupQrScreen(onBack = { navController.popBackStack() })
        }
        composable(
            route = Routes.INVITE_MEMBERS,
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
        ) {
            InviteMembersScreen(
                onBack = { navController.popBackStack() },
                onDone = { navController.popBackStack() },
            )
        }
        }
    }
        CallHost()
        com.vxin.app.feature.call.GroupCallHost()
    }
}

@Composable
private fun SplashScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
