package com.touliao.app.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.data.model.Conversation
import com.touliao.app.data.model.MentionItem
import com.touliao.app.data.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MentionsUiState(
    val loading: Boolean = false,
    val items: List<MentionItem> = emptyList(),
    val loadingMore: Boolean = false,    // 分页加载中
    val hasMore: Boolean = true,         // 后端返回的 hasMore，不再靠本地"返回条数>=页大小"猜
    val total: Int = 0,
    val error: String? = null,
)

private const val PAGE_SIZE = 20

/** 从「@我」条目打开聊天页的跳转参数（对应 Routes.chat 的 title/type/peerUserId） */
data class MentionChatTarget(val conversationId: String, val title: String, val type: String, val peerUserId: String)

/** 服务端 @我 接口对私聊返回的会话名（私聊会话本身没有名字，`conv_name || '私聊'`；群名必填 1-50 字） */
private const val MENTION_PRIVATE_CONV_NAME = "私聊"

/**
 * 「@我」条目 → 聊天页跳转参数。[conv] 是会话列表里同 id 的会话（找不到为 null）。
 * 「@我」接口的条目（MentionItem）不带会话类型和私聊对方，原来一律按私聊打开，群聊就没有群信息、
 * 没有 @ 选人，通话也走 1v1（LIST-M1）。这里按会话列表回填；找不到时（如已「删除聊天（仅自己）」被隐藏，
 * 或会话列表没拉到）名字是「私聊」的按私聊打开（与原行为一致），其余按群聊兜底。
 */
internal fun mentionChatTarget(convId: String, convName: String, conv: Conversation?): MentionChatTarget =
    if (conv != null) {
        MentionChatTarget(
            conversationId = convId,
            // 私聊在 @我 接口里名字固定是「私聊」，会话列表里才是对方昵称/备注
            title = conv.name.ifBlank { convName },
            type = conv.type,
            peerUserId = conv.otherUser?.id.orEmpty(),
        )
    } else {
        MentionChatTarget(
            conversationId = convId,
            title = convName,
            type = if (convName == MENTION_PRIVATE_CONV_NAME) "private" else "group",
            peerUserId = "",
        )
    }

// 分页方式：offset → (createdAt, msgId) 复合游标，见 AUDIT.md 第九节"分页方式"🟡 和
// MessageApi.mentionsMe 的注释。offset 在翻页途中有新 @我消息插入时会把"第N条"的相对
// 位置整体往后推，导致下一页重复看到上一页最后几条；游标锚定在具体某条消息上不受影响。
@HiltViewModel
class MentionsViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MentionsUiState())
    val uiState: StateFlow<MentionsUiState> = _uiState.asStateFlow()

    // convId → 会话列表项（含归档），跳转聊天页时据此透传会话类型/私聊对方；null = 还没拉到
    private var conversationIndex: Map<String, Conversation>? = null

    init { loadFirst() }

    /** 拉会话列表建索引；失败返回 null（不影响 @我 列表本身）。取消异常照常抛出，避免页面离开后还继续跳转 */
    private suspend fun loadConversationIndex(): Map<String, Conversation>? = try {
        chatRepository.loadConversations(includeArchived = true).associateBy { it.id }.also { conversationIndex = it }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** 点击 @我 条目：解析聊天页跳转参数。索引已在加载列表时预取，通常不再发请求；预取失败时这里再拉一次 */
    suspend fun resolveChatTarget(convId: String, convName: String): MentionChatTarget {
        val index = conversationIndex ?: loadConversationIndex()
        return mentionChatTarget(convId, convName, index?.get(convId))
    }

    /** 首次加载（下拉刷新也调此方法）：不带游标，等价于"最新一页" */
    fun loadFirst() {
        _uiState.update { it.copy(loading = true, error = null) }
        // 与 @我 列表并行预取会话列表，点击条目时可直接拿到会话类型
        viewModelScope.launch { loadConversationIndex() }
        viewModelScope.launch {
            runCatching { chatRepository.mentionsMe(limit = PAGE_SIZE) }
                .onSuccess { resp ->
                    _uiState.update {
                        it.copy(
                            loading = false,
                            items = resp.items,
                            total = resp.total,
                            hasMore = resp.hasMore,
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载失败")) }
                }
        }
    }

    /** 下拉分页：用当前已加载列表最后一条（时间上最旧的一条）作为下一页游标 */
    fun loadMore() {
        val state = _uiState.value
        if (state.loadingMore || !state.hasMore) return
        val cursor = state.items.lastOrNull() ?: return
        _uiState.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            runCatching { chatRepository.mentionsMe(before = cursor.createdAt, beforeId = cursor.msgId, limit = PAGE_SIZE) }
                .onSuccess { resp ->
                    val newItems = state.items + resp.items
                    _uiState.update {
                        it.copy(
                            loadingMore = false,
                            items = newItems,
                            total = resp.total,
                            hasMore = resp.hasMore,
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(loadingMore = false, error = e.toUserMessage("加载更多失败")) }
                }
        }
    }
}
