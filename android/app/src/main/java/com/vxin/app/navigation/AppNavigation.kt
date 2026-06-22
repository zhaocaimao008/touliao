package com.vxin.app.navigation

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
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
import com.vxin.app.feature.auth.LoginScreen
import com.vxin.app.feature.auth.RegisterScreen
import com.vxin.app.feature.call.CallHost
import com.vxin.app.feature.chat.ChatScreen
import com.vxin.app.feature.chat.ConversationListScreen
import com.vxin.app.feature.contacts.AddFriendScreen
import com.vxin.app.feature.contacts.ContactsScreen
import com.vxin.app.feature.contacts.CreateGroupScreen
import com.vxin.app.feature.contacts.FriendRequestsScreen
import com.vxin.app.feature.group.GroupInfoScreen
import com.vxin.app.feature.group.GroupQrScreen
import com.vxin.app.feature.group.InviteMembersScreen
import com.vxin.app.feature.profile.MyQrCodeScreen
import com.vxin.app.feature.profile.ProfileScreen
import com.vxin.app.feature.search.SearchScreen
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

@HiltViewModel
class AppViewModel @Inject constructor(
    sessionManager: SessionManager,
) : ViewModel() {
    val authState: StateFlow<AuthState> = sessionManager.state
}

private object Routes {
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val CONVERSATIONS = "conversations"
    const val PROFILE = "profile"
    const val CONTACTS = "contacts"
    const val ADD_FRIEND = "addFriend"
    const val MY_QRCODE = "myQrCode"
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

    when (authState) {
        is AuthState.Loading -> SplashScreen()
        is AuthState.Authenticated -> MainFlow()
        is AuthState.Unauthenticated -> AuthFlow()
    }
}

@Composable
private fun AuthFlow() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.LOGIN) {
        composable(Routes.LOGIN) {
            LoginScreen(onNavigateRegister = { navController.navigate(Routes.REGISTER) })
        }
        composable(Routes.REGISTER) {
            RegisterScreen(onBack = { navController.popBackStack() })
        }
    }
}

private data class TabItem(val route: String, val label: String, val icon: ImageVector)

private val TAB_ITEMS = listOf(
    TabItem(Routes.CONVERSATIONS, "消息", Icons.Filled.Email),
    TabItem(Routes.CONTACTS, "通讯录", Icons.Filled.Person),
    TabItem(Routes.PROFILE, "我", Icons.Filled.AccountCircle),
)
private val TAB_ROUTES = TAB_ITEMS.map { it.route }.toSet()

@Composable
private fun MainFlow() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    Box(Modifier.fillMaxSize()) {
    Scaffold(
        bottomBar = {
            if (currentRoute in TAB_ROUTES) {
                NavigationBar {
                    TAB_ITEMS.forEach { tab ->
                        NavigationBarItem(
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
                )
            }
            composable(Routes.PROFILE) {
                ProfileScreen(onAddAccount = { navController.navigate(Routes.ADD_ACCOUNT) })
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
    }
}

@Composable
private fun SplashScreen() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
