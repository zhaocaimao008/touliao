package com.touliao.app.navigation

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
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
import com.touliao.app.core.auth.AuthState
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.core.update.UpdateChecker
import com.touliao.app.feature.auth.ForgotPasswordScreen
import com.touliao.app.feature.auth.LoginScreen
import com.touliao.app.feature.auth.RegisterScreen
import com.touliao.app.feature.call.CallHost
import com.touliao.app.feature.chat.ChatScreen
import com.touliao.app.feature.chat.ConversationListScreen
import com.touliao.app.feature.contacts.AddFriendScreen
import com.touliao.app.feature.contacts.BlockedScreen
import com.touliao.app.feature.contacts.ContactsScreen
import com.touliao.app.feature.contacts.CreateGroupScreen
import com.touliao.app.feature.contacts.FriendRequestsScreen
import com.touliao.app.feature.group.GroupInfoScreen
import com.touliao.app.feature.group.GroupQrScreen
import com.touliao.app.feature.group.InviteMembersScreen
import com.touliao.app.feature.profile.MyQrCodeScreen
import com.touliao.app.feature.profile.ProfileScreen
import com.touliao.app.feature.search.SearchScreen
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.data.api.ConfigApi
import com.touliao.app.data.repository.ChatRepository
import com.touliao.app.data.model.Features
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
        // 后台 config:updated 实时推送（管理员改开关立即生效，无需重启 App，
        // 对齐 ChatViewModel 里群语音/视频开关的同一套机制）
        viewModelScope.launch { chatRepository.configUpdatedEvents.collect { _features.value = it } }
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

    /**
     * 通知点击只带 conversationId，按本地会话列表回填 name/type/peerUserId 供 Routes.chat 跳转用。
     * 查不到（如列表未刷新到）就给默认值，不阻塞跳转——ChatScreen 进入后会自行拉取会话详情。
     */
    suspend fun resolveChatTarget(conversationId: String): ChatTarget {
        val conv = runCatching { chatRepository.loadConversations() }
            .getOrNull()?.firstOrNull { it.id == conversationId }
        return ChatTarget(
            conversationId = conversationId,
            title = conv?.name.orEmpty(),
            type = conv?.type ?: "private",
            peerUserId = conv?.otherUser?.id.orEmpty(),
        )
    }
}

data class ChatTarget(val conversationId: String, val title: String, val type: String, val peerUserId: String)

object Routes {
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
    const val SETTINGS_HOME = "settingsHome"
    const val PROFILE_EDIT = "profileEdit"
    const val INVITE_FRIEND = "inviteFriend"
    const val MOMENTS = "moments"
    const val MOMENT_COMPOSE = "momentCompose"
    const val REQUESTS = "requests"
    const val CREATE_GROUP = "createGroup"
    const val SEARCH = "search"
    const val ADD_ACCOUNT = "addAccount"
    const val MENTIONS = "mentions"   // @我消息聚合
    const val CONVERSATION_FILES = "conversationFiles/{conversationId}"   // 功能A3: 聊天文件聚合
    const val GROUP_INFO = "groupInfo/{conversationId}"
    const val GROUP_QR = "groupQr/{conversationId}"
    const val INVITE_MEMBERS = "inviteMembers/{conversationId}"
    const val CHAT = "chat/{conversationId}?title={title}&type={type}&peerUserId={peerUserId}"
    fun chat(conversationId: String, title: String, type: String, peerUserId: String = "") =
        "chat/${Uri.encode(conversationId)}?title=${Uri.encode(title)}&type=$type&peerUserId=${Uri.encode(peerUserId)}"
    fun conversationFiles(conversationId: String) = "conversationFiles/$conversationId"
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
        // 启动画面已全部移除：Loading 状态不渲染任何画面，等鉴权结果直接进主界面/登录页
        is AuthState.Loading -> {}
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
// 图标改用自绘品牌图标集 TouliaoIcons（取代 Material 通用图标）
private val TAB_ITEMS = listOf(
    TabItem(Routes.CONVERSATIONS, "消息", TouliaoIcons.Chat, "chats"),
    TabItem(Routes.CONTACTS, "通讯录", TouliaoIcons.Contacts, "contacts"),
    TabItem(Routes.PROFILE, "我", TouliaoIcons.Me, "me"),
)
private val TAB_ROUTES = TAB_ITEMS.map { it.route }.toSet()

@Composable
private fun MainFlow(features: Features, unreadTotal: Int = 0, appViewModel: AppViewModel = hiltViewModel()) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // 底部 tab 已固定为 消息/通讯录/我，无需再按 features 开关过滤
    val visibleTabs = TAB_ITEMS

    // 通知点击跳会话：navController 在这里已就绪，消费 PendingConversationHolder 并导航。
    // 用 LaunchedEffect(Unit) + collect（而非 LaunchedEffect(pendingConvId) 配合状态变量）：
    // 后者若在协程体内把 holder 置空会改变自己的 key，导致 Compose 在 resolveChatTarget/navigate
    // 完成前就把这次 effect 取消掉（自取消），锁屏点击进会话可能因此失效。这里改为在同一个协程里
    // collect，且导航成功后才清空 holder，避免自取消，也避免重复消费同一个 convId。
    androidx.compose.runtime.LaunchedEffect(Unit) {
        PendingConversationHolder.conversationId.collect { convId ->
            if (convId == null) return@collect
            // navigate/resolveChatTarget 抛异常时若不捕获，collect 所在协程会直接死亡，
            // 且 LaunchedEffect(Unit) 不会因 key 不变而重启 → 之后所有通知点击都静默失效。
            runCatching {
                val target = appViewModel.resolveChatTarget(convId)
                navController.navigate(Routes.chat(target.conversationId, target.title, target.type, target.peerUserId)) {
                    launchSingleTop = true
                }
            }.onFailure { android.util.Log.e("AppNavigation", "通知跳转会话失败 convId=$convId", it) }
            // compareAndSet 而非无条件置 null：快速连点两个不同会话通知时，先处理完的一次
            // 不能把此刻已经是「第二个会话」的新值误清掉，只清掉自己刚消费的那个旧值。
            PendingConversationHolder.conversationId.compareAndSet(convId, null)
        }
    }

    Box(Modifier.fillMaxSize()) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            if (currentRoute in TAB_ROUTES) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = com.touliao.app.ui.theme.VxinBrand,
                ) {
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
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = com.touliao.app.ui.theme.VxinBrand,
                                selectedTextColor = com.touliao.app.ui.theme.VxinBrand,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                indicatorColor = com.touliao.app.ui.theme.VxinBrandMuted,
                            ),
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
                    onOpenMentions = { navController.navigate(Routes.MENTIONS) },
                    showMoments = features.moments,
                    onOpenMoments = { navController.navigate(Routes.MOMENTS) },
                )
            }
            composable(Routes.MENTIONS) {
                com.touliao.app.feature.chat.MentionsScreen(
                    onBack = { navController.popBackStack() },
                    onOpenConversation = { convId, convName ->
                        // 跳转对应会话（不携带 peerUserId，因为 @我 可能来自群聊）
                        navController.navigate(Routes.chat(convId, convName, "private"))
                    },
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
                com.touliao.app.feature.labels.FriendLabelsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.PROFILE) {
                ProfileScreen(
                    onAddAccount = { navController.navigate(Routes.ADD_ACCOUNT) },
                    onOpenMyQr = { navController.navigate(Routes.MY_QRCODE) },
                    onOpenCallHistory = { navController.navigate(Routes.CALL_HISTORY) },
                    onOpenWallet = { navController.navigate(Routes.WALLET) },
                    onOpenSessions = { navController.navigate(Routes.SESSIONS) },
                    onOpenInviteFriend = { navController.navigate(Routes.INVITE_FRIEND) },
                    onOpenSettings = { navController.navigate(Routes.SETTINGS_HOME) },
                    onOpenProfileEdit = { navController.navigate(Routes.PROFILE_EDIT) },
                )
            }
            composable(Routes.SETTINGS_HOME) {
                com.touliao.app.feature.settings.SettingsHomeScreen(
                    onBack = { navController.popBackStack() },
                    onOpenNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
                    onOpenPrivacy = { navController.navigate(Routes.PRIVACY) },
                    onOpenAppearance = { navController.navigate(Routes.APPEARANCE) },
                    onOpenSessions = { navController.navigate(Routes.SESSIONS) },
                )
            }
            composable(Routes.PROFILE_EDIT) {
                com.touliao.app.feature.profile.ProfileEditScreen(
                    onBack = { navController.popBackStack() },
                    onOpenMyQr = { navController.navigate(Routes.MY_QRCODE) },
                )
            }
            composable(Routes.INVITE_FRIEND) {
                com.touliao.app.feature.profile.InviteFriendScreen(
                    onBack = { navController.popBackStack() },
                )
            }
            composable(Routes.WALLET) {
                com.touliao.app.feature.wallet.WalletScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.SESSIONS) {
                com.touliao.app.feature.sessions.SessionsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.PRIVACY) {
                com.touliao.app.feature.settings.PrivacySettingsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.NOTIFICATIONS) {
                com.touliao.app.feature.settings.NotificationSettingsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.APPEARANCE) {
                com.touliao.app.feature.settings.AppearanceSettingsScreen(onBack = { navController.popBackStack() })
            }
            composable(Routes.CALL_HISTORY) {
                com.touliao.app.feature.callhistory.CallHistoryScreen(
                    onBack = { navController.popBackStack() },
                    onOpenChat = { target -> navController.navigate(Routes.chat(target.conversationId, target.title, "private", target.peerUserId)) },
                )
            }
            // 收藏 仍按需移除；朋友圈改为「消息」页顶栏图标入口（方案A，2026-09-02），
            // 受后台 features.moments 开关实时控制（不在底部导航常驻，符合新手引导简化的原始考量）。
            composable(Routes.MOMENTS) {
                com.touliao.app.feature.moments.MomentsScreen(
                    onBack = { navController.popBackStack() },
                    onCompose = { navController.navigate(Routes.MOMENT_COMPOSE) },
                )
            }
            composable(Routes.MOMENT_COMPOSE) {
                com.touliao.app.feature.moments.MomentComposeScreen(
                    onBack = { navController.popBackStack() },
                    onPublished = { navController.popBackStack() },
                )
            }
            composable(Routes.ADD_ACCOUNT) {
                LoginScreen(
                    onNavigateRegister = { navController.navigate(Routes.REGISTER) },
                    onSuccess = { navController.popBackStack(Routes.CONVERSATIONS, inclusive = false) },
                    onBack = { navController.popBackStack() },
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
                onOpenFiles = { convId -> navController.navigate(Routes.conversationFiles(convId)) },
            )
        }
        composable(
            route = Routes.CONVERSATION_FILES,
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
        ) {
            com.touliao.app.feature.chat.ConversationFilesScreen(onBack = { navController.popBackStack() })
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
        CallHost(navController = navController)
        com.touliao.app.feature.call.GroupCallHost()
    }
}

