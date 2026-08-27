package com.touliao.app.navigation

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * 通知点击待跳转的会话 id。
 *
 * 冷启动时 MainActivity.onCreate 里 navController 还未随 Compose 组合完成，直接 navigate 会 NPE，
 * 所以改为写入这个可观察 holder，AppNavigation 用 LaunchedEffect 监听后再消费导航（此时
 * navController 一定已就绪）。MainActivity（onCreate/onNewIntent）与 AppNavigation 双方持有。
 */
object PendingConversationHolder {
    val conversationId = MutableStateFlow<String?>(null)
}
