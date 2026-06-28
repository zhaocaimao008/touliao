package com.vxin.app.navigation

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
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
import com.vxin.app.feature.favorites.FavoritesScreen
import com.vxin.app.feature.moments.MomentComposeScreen
import com.vxin.app.feature.moments.MomentsScreen
import com.vxin.app.feature.group.GroupInfoScreen
import com.vxin.app.feature.group.GroupQrScreen
import com.vxin.app.feature.group.InviteMembersScreen
import com.vxin.app.feature.profile.MyQrCodeScreen
import com.vxin.app.feature.profile.ProfileScreen
import com.vxin.app.feature.search.SearchScreen
import com.vxin.app.data.api.ConfigApi
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
) : ViewModel() {
    val authState: StateFlow<AuthState> = sessionManager.state

    // 后台功能开关（朋友圈/收藏）。默认全开，拉取失败不误伤已有功能。
    private val _features = MutableStateFlow(Features())
    val features: StateFlow<Features> = _features.asStateFlow()

    init {
        viewModelScope.launch {
            runCatching { configApi.getConfig() }.onSuccess { _features.value = it.features }
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
    const val MOMENTS = "moments"
    const val MOMENT_COMPOSE = "momentCompose"
    const val REQUESTS = "requests"
    const val CREATE_GROUP = "createGroup"
    const val SEARCH = "search"
    const val ADD_ACCOUNT = "addAccount"
    const val GROUP_INFO = "groupInfo/{conversationId}"
    const val GROUP_QR = "groupQr/{conversationId}"
    const val INVITE_MEMBERS = "inviteMembers/{conversationId}"
    const val CHAT = "chat/{conversationId}?title={title}&type={type}"
    fun chat(conversationId: String, title: String, type: String) =
        "chat/$conversationId?title=${Uri.encode(title)}&type=$type"
    fun groupInfo(conversationId: String) = "groupInfo/$conversationId"
    fun groupQr(conversationId: String) = "groupQr/$conversationId"
    fun inviteMembers(conversationId: String) = "inviteMembers/$conversationId"
}

@Composable
fun AppNavigation(appViewModel: AppViewModel = hiltViewModel()) {
    val authState by appViewModel.authState.collectAsStateWithLifecycle()
    val features by appViewModel.features.collectAsStateWithLifecycle()

    when (authState) {
        is AuthState.Loading -> SplashScreen()
        is AuthState.Authenticated -> MainFlow(features)
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

private val TAB_ITEMS = listOf(
    TabItem(Routes.CONVERSATIONS, "消息", Icons.Filled.Email, "chats"),
    TabItem(Routes.CONTACTS, "通讯录", Icons.Filled.Person, "contacts"),
    TabItem(Routes.MOMENTS, "朋友圈", Icons.Filled.DateRange, "moments"),
    TabItem(Routes.FAVORITES, "收藏", Icons.Filled.Star, "favorites"),
    TabItem(Routes.PROFILE, "我", Icons.Filled.AccountCircle, "me"),
)
private val TAB_ROUTES = TAB_ITEMS.map { it.route }.toSet()

@Composable
private fun MainFlow(features: Features) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // 后台开关：隐藏朋友圈/收藏 tab（拉取失败时默认全开，见 AppViewModel）
    val visibleTabs = TAB_ITEMS.filter { tab ->
        when (tab.route) {
            Routes.MOMENTS -> features.moments
            Routes.FAVORITES -> features.collect
            else -> true
        }
    }

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
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
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
                    onOpenConversation = { conv -> navController.navigate(Routes.chat(conv.id, conv.name, conv.type)) },
                    onOpenSearch = { navController.navigate(Routes.SEARCH) },
                )
            }
            composable(Routes.SEARCH) {
                SearchScreen(
                    onBack = { navController.popBackStack() },
                    onOpenResult = { r -> navController.navigate(Routes.chat(r.conversation_id, r.convName, r.convType)) },
                )
            }
            composable(Routes.CONTACTS) {
                ContactsScreen(
                    onOpenChat = { target -> navController.navigate(Routes.chat(target.conversationId, target.title, "private")) },
                    onAddFriend = { navController.navigate(Routes.ADD_FRIEND) },
                    onRequests = { navController.navigate(Routes.REQUESTS) },
                    onCreateGroup = { navController.navigate(Routes.CREATE_GROUP) },
                    onOpenBlocked = { navController.navigate(Routes.BLOCKED) },
                )
            }
            composable(Routes.PROFILE) {
                ProfileScreen(
                    onAddAccount = { navController.navigate(Routes.ADD_ACCOUNT) },
                )
            }
            composable(Routes.FAVORITES) {
                // 作为底部 Tab：不传 onBack（无返回箭头）
                FavoritesScreen()
            }
            composable(Routes.MOMENTS) {
                // 作为底部 Tab：不传 onBack（无返回箭头）
                MomentsScreen(
                    onCompose = { navController.navigate(Routes.MOMENT_COMPOSE) },
                )
            }
            composable(Routes.MOMENT_COMPOSE) {
                MomentComposeScreen(
                    onBack = { navController.popBackStack() },
                    onPublished = { navController.popBackStack() },
                )
            }
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
