package com.touliao.app.data.repository

import android.util.Log
import com.touliao.app.core.di.AppScope
import com.touliao.app.core.util.AppForeground
import com.touliao.app.data.api.MessageApi
import com.touliao.app.data.model.MarkReadRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** 已读位置：服务端消息 id + 顺序依据（server_sequence 优先，缺失时用 created_at）。 */
internal data class ReadMark(val messageId: String, val seq: Long, val createdAt: Long) {
    /** 是否比 [other] 更新：双方都有 seq 时比 seq，否则比 created_at（同秒不同 id 视为更新，宁多报一次不漏报）。 */
    fun isNewerThan(other: ReadMark?): Boolean {
        if (other == null) return true
        if (messageId == other.messageId) return false
        if (seq > 0 && other.seq > 0) return seq > other.seq
        return createdAt > other.createdAt || (createdAt == other.createdAt && seq >= other.seq)
    }
}

/**
 * 已读上报节流状态机（纯逻辑，无协程/时间依赖，便于单测）。
 *  - 只有「比上次已上报更新」的位置才进入待发；
 *  - 每个会话同一时刻最多一个待发定时器（[submit] 返回 true 时由调用方安排 debounce 后 [take]）；
 *  - 后台时 [take] 不出队（保留待发），回前台再补发。
 */
internal class ReadReportThrottle {
    private val lastReported = HashMap<String, ReadMark>()
    private val pending = HashMap<String, ReadMark>()
    private val scheduled = HashSet<String>()

    /** 提交一次「已看到的最新消息」。返回 true = 需要为该会话安排一次 debounce 发送。 */
    @Synchronized fun submit(conversationId: String, mark: ReadMark): Boolean {
        val base = pending[conversationId] ?: lastReported[conversationId]
        if (!mark.isNewerThan(base)) return false
        pending[conversationId] = mark
        return scheduled.add(conversationId)
    }

    /** debounce 到点：前台则取出待发并乐观记为已上报；后台返回 null（保留待发，等回前台）。 */
    @Synchronized fun take(conversationId: String, foreground: Boolean): ReadMark? {
        scheduled.remove(conversationId)
        if (!foreground) return null
        val mark = pending.remove(conversationId) ?: return null
        if (!mark.isNewerThan(lastReported[conversationId])) return null
        lastReported[conversationId] = mark
        return mark
    }

    /** 发送失败：撤销乐观记录，后续同一位置可再次上报。 */
    @Synchronized fun onFailed(conversationId: String, mark: ReadMark) {
        if (lastReported[conversationId] == mark) lastReported.remove(conversationId)
    }

    /** 回到前台时：有待发但当前没有定时器的会话（后台被跳过的）。调用方逐个重新安排。 */
    @Synchronized fun pendingUnscheduled(): List<String> =
        pending.keys.filter { scheduled.add(it) }

    /** 会话被「全部标为已读」等外部方式处理过 / 账号切换：清空该会话或全部状态。 */
    @Synchronized fun reset(conversationId: String? = null) {
        if (conversationId == null) { lastReported.clear(); pending.clear(); scheduled.clear() }
        else { lastReported.remove(conversationId); pending.remove(conversationId) }
    }
}

/**
 * 会话已读上报（POST /api/messages/conversation/:id/read，后端调用量第一的路由，~11k/天）。
 * 此前聊天页每收到一条消息 / 每次滚回底部 / 进出会话都直发一次，且不比较位置。现在：
 *  - 只有最新已看到的消息比上次上报的更新才发；
 *  - 每会话 debounce [DEBOUNCE_MS]，连续消息合并为一次；
 *  - App 在后台不发（用户没看到），回到前台补发。
 */
@Singleton
class ReadReporter @Inject constructor(
    private val api: MessageApi,
    @AppScope private val scope: CoroutineScope,
) {
    private val throttle = ReadReportThrottle()

    init {
        scope.launch {
            AppForeground.state.filter { it }.collect {
                throttle.pendingUnscheduled().forEach { schedule(it) }
            }
        }
    }

    /** 报告「已看到 [messageId] 这条」。本地乐观/待发消息（无服务端 id）由调用方过滤。 */
    fun report(conversationId: String, messageId: String, seq: Long, createdAt: Long) {
        if (conversationId.isBlank() || messageId.isBlank()) return
        if (throttle.submit(conversationId, ReadMark(messageId, seq, createdAt))) schedule(conversationId)
    }

    /**
     * 进入会话：忘掉该会话上次上报的位置，保证「打开会话 → 至少标一次已读」语义不变
     * （期间可能在别处被「标为未读」）；之后同一次停留内的重复/更旧位置照常去重。
     */
    fun onConversationOpened(conversationId: String) = throttle.reset(conversationId)

    private fun schedule(conversationId: String) {
        scope.launch {
            delay(DEBOUNCE_MS)
            val mark = throttle.take(conversationId, AppForeground.isForeground) ?: return@launch
            runCatching { api.markRead(conversationId, MarkReadRequest(mark.messageId)) }
                .onFailure {
                    if (it is kotlinx.coroutines.CancellationException) throw it
                    throttle.onFailed(conversationId, mark)
                    Log.d(TAG, "markRead failed: ${it.message}")
                }
        }
    }

    private companion object {
        const val TAG = "ReadReporter"
        const val DEBOUNCE_MS = 800L
    }
}
