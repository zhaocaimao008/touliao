package com.touliao.app.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.data.model.MentionItem
import com.touliao.app.data.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
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

// 分页方式：offset → (createdAt, msgId) 复合游标，见 AUDIT.md 第九节"分页方式"🟡 和
// MessageApi.mentionsMe 的注释。offset 在翻页途中有新 @我消息插入时会把"第N条"的相对
// 位置整体往后推，导致下一页重复看到上一页最后几条；游标锚定在具体某条消息上不受影响。
@HiltViewModel
class MentionsViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MentionsUiState())
    val uiState: StateFlow<MentionsUiState> = _uiState.asStateFlow()

    init { loadFirst() }

    /** 首次加载（下拉刷新也调此方法）：不带游标，等价于"最新一页" */
    fun loadFirst() {
        _uiState.update { it.copy(loading = true, error = null) }
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
