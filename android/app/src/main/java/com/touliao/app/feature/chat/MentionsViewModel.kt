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
    val hasMore: Boolean = true,         // 是否还有更多（offset+limit < total）
    val total: Int = 0,
    val error: String? = null,
)

private const val PAGE_SIZE = 20

@HiltViewModel
class MentionsViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MentionsUiState())
    val uiState: StateFlow<MentionsUiState> = _uiState.asStateFlow()

    init { loadFirst() }

    /** 首次加载（下拉刷新也调此方法） */
    fun loadFirst() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { chatRepository.mentionsMe(offset = 0, limit = PAGE_SIZE) }
                .onSuccess { resp ->
                    _uiState.update {
                        it.copy(
                            loading = false,
                            items = resp.items,
                            total = resp.total,
                            hasMore = resp.items.size >= PAGE_SIZE,
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载失败")) }
                }
        }
    }

    /** 下拉分页：加载下一页 */
    fun loadMore() {
        val state = _uiState.value
        if (state.loadingMore || !state.hasMore) return
        _uiState.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            val offset = state.items.size
            runCatching { chatRepository.mentionsMe(offset = offset, limit = PAGE_SIZE) }
                .onSuccess { resp ->
                    val newItems = state.items + resp.items
                    _uiState.update {
                        it.copy(
                            loadingMore = false,
                            items = newItems,
                            total = resp.total,
                            hasMore = resp.items.size >= PAGE_SIZE,
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(loadingMore = false, error = e.toUserMessage("加载更多失败")) }
                }
        }
    }
}
