package com.vxin.app.core.push

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.di.AppScope
import com.vxin.app.data.api.UserApi
import com.vxin.app.data.model.Message
import com.vxin.app.data.repository.ChatRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 后台消息本地通知桥。
 *
 * 场景②「幽灵在线」：App 退到后台/锁屏但进程还活着、socket 仍连着时，服务端判定用户
 * 「在线」→ 不发 FCM 推送，消息只经 socket 静默到达 → 锁屏/后台看不到任何提醒。
 * 这里补一条本地通知，与 FCM 天然不重复：
 *   · socket 连着（在线）→ 服务端不发 FCM → 由本桥通知；
 *   · socket 断开（离线）→ 服务端发 FCM → 由 VxinMessagingService 通知。
 * 且通知 id 以 conversationId 为键，两条路径即便边界重叠也只会互相覆盖、不叠加。
 *
 * 仅后台时触发；前台交给聊天页/会话列表正常刷新，不打扰。
 *
 * 免打扰：与服务端 FCM 路径对齐——尊重「全局新消息通知」总开关 + 该会话「消息免打扰」，
 * 并按「通知详情预览」决定展示正文还是「收到一条新消息」。设置带 TTL 缓存，后台消息
 * 到达时按需刷新（节流，避免每条消息都打网络）。
 */
@Singleton
class MessageNotificationBridge @Inject constructor(
    private val chatRepository: ChatRepository,
    private val userApi: UserApi,
    private val notificationHelper: NotificationHelper,
    private val sessionManager: SessionManager,
    @AppScope private val scope: CoroutineScope,
) : Application.ActivityLifecycleCallbacks {

    private val startedActivities = AtomicInteger(0)
    private val isForeground: Boolean get() = startedActivities.get() > 0

    // ── 免打扰缓存（TTL 60s，后台消息到达时懒刷新）──
    @Volatile private var messageNotifyEnabled = true       // 全局新消息通知总开关
    @Volatile private var detailPreviewEnabled = true       // 通知详情预览
    @Volatile private var mutedConversations: Set<String> = emptySet() // 免打扰会话集合
    @Volatile private var settingsLoadedAt = 0L
    private val refreshMutex = Mutex()

    /** 由 VxinApp.onCreate 调用一次：注册前后台追踪 + 开始监听 socket 新消息。 */
    fun install(app: Application) {
        app.registerActivityLifecycleCallbacks(this)
        scope.launch {
            chatRepository.incomingMessages.collect { msg ->
                if (isForeground) return@collect                                  // 前台无需通知
                if (msg.sender_id == sessionManager.currentUser?.id) return@collect // 自己发的不提醒
                if (msg.deleted == 1) return@collect                              // 已撤回/删除不提醒
                refreshMuteStateIfStale()
                if (!messageNotifyEnabled) return@collect                         // 全局关新消息通知
                if (msg.conversation_id in mutedConversations) return@collect     // 该会话免打扰
                notificationHelper.showMessageNotification(
                    title = msg.senderName.ifBlank { "新消息" },
                    body = if (detailPreviewEnabled) previewOf(msg) else "收到一条新消息",
                    conversationId = msg.conversation_id,
                )
            }
        }
    }

    /** 刷新全局通知开关与免打扰会话集合（TTL 内跳过；双重检查避免并发重复拉取）。 */
    private suspend fun refreshMuteStateIfStale() {
        if (System.currentTimeMillis() - settingsLoadedAt < SETTINGS_TTL_MS) return
        refreshMutex.withLock {
            if (System.currentTimeMillis() - settingsLoadedAt < SETTINGS_TTL_MS) return@withLock
            runCatching { userApi.settings() }.onSuccess {
                messageNotifyEnabled = it.messageNotify
                detailPreviewEnabled = it.detailPreview
            }
            runCatching { chatRepository.loadConversations() }.onSuccess { list ->
                mutedConversations = list.filter { it.muted == 1 }.map { it.id }.toSet()
            }
            settingsLoadedAt = System.currentTimeMillis()
        }
    }

    /** 与后端 buildBody 对齐的通知正文预览。 */
    private fun previewOf(msg: Message): String = when (msg.type) {
        "image" -> "[图片]"
        "voice" -> "[语音]"
        "video" -> "[视频]"
        "file" -> "[文件] " + msg.content.take(50)
        "location" -> "[位置]"
        "red_packet" -> "[红包] 恭喜发财"
        "contact_card" -> "[名片]"
        else -> msg.content.take(100)
    }

    override fun onActivityStarted(activity: Activity) { startedActivities.incrementAndGet() }
    override fun onActivityStopped(activity: Activity) {
        if (startedActivities.get() > 0) startedActivities.decrementAndGet()
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}

    private companion object {
        const val SETTINGS_TTL_MS = 60_000L
    }
}
