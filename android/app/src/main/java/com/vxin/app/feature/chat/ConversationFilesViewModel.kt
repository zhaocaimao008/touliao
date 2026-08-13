package com.touliao.app.feature.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.core.util.MediaUrlResolver
import com.touliao.app.data.model.ConversationFile
import com.touliao.app.data.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 文件聚合 tab（对应后端 type 参数） */
enum class FileTab(val type: String, val label: String) {
    ALL("all", "全部"),
    IMAGE("image", "图片"),
    VIDEO("video", "视频"),
    FILE("file", "文件"),
}

data class ConversationFilesUiState(
    val tab: FileTab = FileTab.ALL,
    val loading: Boolean = false,
    val items: List<ConversationFile> = emptyList(),
    val loadingMore: Boolean = false,
    val hasMore: Boolean = true,
    val total: Int = 0,
    val error: String? = null,
)

private const val PAGE_SIZE = 30

@HiltViewModel
class ConversationFilesViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    private val mediaUrlResolver: MediaUrlResolver,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val conversationId: String = savedStateHandle.get<String>("conversationId").orEmpty()

    private val _uiState = MutableStateFlow(ConversationFilesUiState())
    val uiState: StateFlow<ConversationFilesUiState> = _uiState.asStateFlow()

    init { loadFirst() }

    /** /uploads 相对路径 → 带 token 的绝对地址（供 Coil 加载缩略图/预览） */
    fun resolveMediaUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    /** 切换 tab：重置列表并重新加载 */
    fun switchTab(tab: FileTab) {
        if (tab == _uiState.value.tab) return
        _uiState.update { it.copy(tab = tab, items = emptyList(), hasMore = true) }
        loadFirst()
    }

    /** 首次加载 / 下拉刷新 */
    fun loadFirst() {
        val tab = _uiState.value.tab
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { chatRepository.conversationFiles(conversationId, type = tab.type, offset = 0, limit = PAGE_SIZE) }
                .onSuccess { resp ->
                    // 加载完成后 tab 可能已切换 → 丢弃过期结果
                    if (_uiState.value.tab != tab) return@onSuccess
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
                    if (_uiState.value.tab != tab) return@onFailure
                    _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载失败")) }
                }
        }
    }

    /** 下拉分页：按返回条数判断 hasMore */
    fun loadMore() {
        val state = _uiState.value
        if (state.loadingMore || state.loading || !state.hasMore) return
        val tab = state.tab
        _uiState.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            val offset = state.items.size
            runCatching { chatRepository.conversationFiles(conversationId, type = tab.type, offset = offset, limit = PAGE_SIZE) }
                .onSuccess { resp ->
                    if (_uiState.value.tab != tab) return@onSuccess
                    _uiState.update {
                        it.copy(
                            loadingMore = false,
                            items = it.items + resp.items,
                            total = resp.total,
                            hasMore = resp.items.size >= PAGE_SIZE,
                        )
                    }
                }
                .onFailure { e ->
                    if (_uiState.value.tab != tab) return@onFailure
                    _uiState.update { it.copy(loadingMore = false, error = e.toUserMessage("加载更多失败")) }
                }
        }
    }
}
