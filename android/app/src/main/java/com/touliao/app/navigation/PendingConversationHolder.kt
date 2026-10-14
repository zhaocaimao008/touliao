package com.touliao.app.navigation

import kotlinx.coroutines.flow.MutableStateFlow
import java.util.concurrent.ConcurrentHashMap

/**
 * 通知点击待跳转的会话 id。
 *
 * 冷启动时 MainActivity.onCreate 里 navController 还未随 Compose 组合完成，直接 navigate 会 NPE，
 * 所以改为写入这个可观察 holder，AppNavigation 用 LaunchedEffect 监听后再消费导航（此时
 * navController 一定已就绪）。MainActivity（onCreate/onNewIntent）与 AppNavigation 双方持有。
 *
 * 通话页（CallActivity）里没有 NavController：拒接后「回复消息」新建的私聊会话可能还不在本地会话列表里，
 * 只给 id 的话聊天页标题和对端 id 会是空的。所以由 [offer] 把标题和对端 id 作为提示一并带过去，
 * AppNavigation 消费时用 [takeHint] 取出，会话列表查不到时用它兜底。
 */
object PendingConversationHolder {
    val conversationId = MutableStateFlow<String?>(null)

    /** 会话 id → (标题, 对端 userId)。取出即删，不会越积越多。 */
    private val hints = ConcurrentHashMap<String, Pair<String, String>>()

    /** 先记录提示，再写会话 id：收集方看到 id 时提示一定已就位。 */
    fun offer(conversationId: String, title: String, peerUserId: String) {
        hints[conversationId] = title to peerUserId
        this.conversationId.value = conversationId
    }

    /** 取出并删除该会话的提示，返回 (标题, 对端 userId)；没有则返回 null。 */
    fun takeHint(conversationId: String): Pair<String, String>? = hints.remove(conversationId)
}
