package com.touliao.app.core.call

import android.os.SystemClock
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.core.di.AppScope
import com.touliao.app.data.repository.GroupRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 某个群的名单快照（跨包契约 C6）：群名 + 成员 id → 群昵称（没有群昵称时为用户名）。
 * 使用方必须先确认 [conversationId] 与当前群通话的 conversationId 相同，才能使用名单。
 */
data class GroupRoster(
    val conversationId: String = "",
    val groupName: String = "",
    val names: Map<String, String> = emptyMap(),
) {
    /** 成员显示名：名单里有且不为空白时返回它，否则返回"群成员"。 */
    fun nameOf(userId: String): String = names[userId]?.takeIf { it.isNotBlank() } ?: "群成员"
}

/**
 * 群通话名单缓存（CALL-11）：给群通话宫格、"通话中"通知和群邀请通知提供群名与成员昵称。
 * - 缓存 5 分钟；群通话里出现名单中没有的成员时，距上次拉取满 10 秒才强制刷新（最多每 10 秒一次）；
 * - 收到当前群的 groupChanged 时强制刷新；
 * - 身份清理（登出/切号）时清空。
 * 所有依赖都用 dagger.Lazy，并只在 AppScope 协程里取用，构造本身不触发任何初始化。
 */
@Singleton
class GroupCallRoster @Inject constructor(
    private val groupRepository: dagger.Lazy<GroupRepository>,
    private val groupCallManager: dagger.Lazy<GroupCallManager>,
    private val sessionManager: dagger.Lazy<SessionManager>,
    @AppScope private val scope: CoroutineScope,
) {
    // 会话 id → (拉取时的 elapsedRealtime, 名单)
    private val cache = ConcurrentHashMap<String, Pair<Long, GroupRoster>>()

    private val _state = MutableStateFlow(GroupRoster())
    /** 当前或最近一次群通话所在群的名单。 */
    val state: StateFlow<GroupRoster> = _state.asStateFlow()

    // 身份代数：身份清理后自增，清理前发出的拉取结果不得再写回缓存
    @Volatile private var generation = 0

    init {
        scope.launch {
            sessionManager.get().onIdentityCleanup {
                generation++
                cache.clear()
                _state.value = GroupRoster()
            }
            // 群资料/成员变更：当前名单所在群强制刷新；其他群只作废缓存，下次用到时再拉
            launch {
                groupRepository.get().groupChangedEvents.collect { id ->
                    if (id.isEmpty()) return@collect
                    if (id != _state.value.conversationId) {
                        cache.remove(id)
                        return@collect
                    }
                    val fresh = fetch(id) ?: return@collect   // 失败保留旧值
                    if (_state.value.conversationId == id) _state.value = fresh
                }
            }
            // 群通话进行中：按 (会话 id, 参与者) 维护名单。不在通话中映射为 null 并参与去重：
            // 同一个群前后两通的首个状态相同时也会重新检查缓存；通话结束时取消未完成的拉取
            groupCallManager.get().state
                .map { g ->
                    if (CallUiRules.isGroupActive(g.stage) && g.conversationId.isNotEmpty()) {
                        g.conversationId to g.participants
                    } else {
                        null
                    }
                }
                .distinctUntilChanged()
                .collectLatest { active -> if (active != null) onGroupActive(active.first, active.second) }
        }
    }

    /** 群名（带缓存）：缓存有效直接返回；否则拉取，拉取失败时退回旧缓存，都没有返回 ""。 */
    suspend fun groupName(conversationId: String): String {
        if (conversationId.isEmpty()) return ""
        val cached = cache[conversationId]
        if (cached != null && SystemClock.elapsedRealtime() - cached.first < CACHE_TTL_MS) return cached.second.groupName
        return fetch(conversationId)?.groupName ?: cached?.second?.groupName.orEmpty()
    }

    private suspend fun onGroupActive(cid: String, participants: List<String>) {
        val cached = cache[cid]
        // 有缓存先发布，宫格立即有名字可用
        if (cached != null) _state.value = cached.second
        val age = if (cached != null) SystemClock.elapsedRealtime() - cached.first else Long.MAX_VALUE
        val expired = cached == null || age >= CACHE_TTL_MS
        val hasUnknown = cached != null && participants.any { it !in cached.second.names }
        if (!expired && !hasUnknown) return
        if (!expired && age < FORCE_REFRESH_INTERVAL_MS) {
            // 有新成员但距上次拉取不足 10 秒：等满 10 秒再拉（期间参与者变化会被 collectLatest 取消重算）
            delay(FORCE_REFRESH_INTERVAL_MS - age)
        }
        val fresh = fetch(cid) ?: return   // 失败保留旧值
        _state.value = fresh
    }

    /** 拉取并写入缓存；失败返回 null（不抛异常，协程取消除外）。 */
    private suspend fun fetch(cid: String): GroupRoster? {
        val gen = generation
        val info = runCatching { groupRepository.get().info(cid) }
            .onFailure { if (it is CancellationException) throw it }
            .getOrNull() ?: return null
        val roster = GroupRoster(cid, info.name, info.members.associate { it.id to it.displayName })
        if (gen != generation) return null   // 拉取期间发生了身份清理，丢弃
        cache[cid] = SystemClock.elapsedRealtime() to roster
        return roster
    }

    private companion object {
        const val CACHE_TTL_MS = 5 * 60_000L          // 名单缓存有效期 5 分钟
        const val FORCE_REFRESH_INTERVAL_MS = 10_000L // 出现未知成员时的强制刷新最小间隔
    }
}
