package com.touliao.app.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.core.util.MediaUrlResolver
import com.touliao.app.data.model.SearchResult
import com.touliao.app.data.repository.SearchRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 发送人筛选选项（从结果集累积而来，成本远低于全量拉成员表） */
data class SenderOption(val id: String, val name: String)

data class SearchUiState(
    val query: String = "",
    val loading: Boolean = false,
    val results: List<SearchResult> = emptyList(),
    val searched: Boolean = false,
    val error: String? = null,
    // ── F4b 分类筛选（与输入并存，变更后走同一 debounce 重搜）──
    val typeFilter: String = "",          // 空=全部；映射后端 messages.type
    val timeRange: String = "",           // 空=不限 | today | 7d | 30d
    val senderId: String = "",            // 空=全部发送人
    val senderOptions: List<SenderOption> = emptyList(),
)

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchRepository: SearchRepository,
    private val mediaUrlResolver: MediaUrlResolver,
) : ViewModel() {

    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    private var searchJob: Job? = null

    fun onQueryChange(v: String) {
        _uiState.update { it.copy(query = v) }
        searchJob?.cancel()
        if (v.isBlank()) {
            _uiState.update { it.copy(results = emptyList(), searched = false, loading = false) }
            return
        }
        // 输入防抖 300ms
        searchJob = viewModelScope.launch {
            delay(300)
            runSearch(v.trim())
        }
    }

    /** 筛选变更：与输入并存，同样 300ms 防抖后重搜（对齐 Web：筛选进 effect 依赖） */
    fun onTypeFilterChange(v: String) {
        _uiState.update { it.copy(typeFilter = v) }
        scheduleSearch()
    }

    fun onTimeRangeChange(v: String) {
        _uiState.update { it.copy(timeRange = v) }
        scheduleSearch()
    }

    fun onSenderChange(v: String) {
        _uiState.update { it.copy(senderId = v) }
        scheduleSearch()
    }

    private fun scheduleSearch() {
        val q = _uiState.value.query.trim()
        searchJob?.cancel()
        if (q.isEmpty()) return   // 无关键词不搜索（筛选与输入并存，输入空=回到初始态）
        searchJob = viewModelScope.launch {
            delay(300)
            runSearch(q)
        }
    }

    private suspend fun runSearch(q: String) {
        val s = _uiState.value
        val filters = buildSearchFilterParams(s.typeFilter, s.timeRange, s.senderId)
        _uiState.update { it.copy(loading = true, error = null) }
        runCatching {
            searchRepository.search(
                q,
                type = filters.type,
                from = filters.fromSec,
                to = filters.toSec,
                senderId = filters.senderId,
            )
        }
            .onSuccess { list ->
                _uiState.update { st ->
                    // 发送人选项由结果集累积（去重；跨筛选切换保留，便于选回之前的发送人）
                    val byId = linkedMapOf<String, SenderOption>()
                    st.senderOptions.forEach { byId[it.id] = it }
                    list.forEach { r -> if (r.sender_id.isNotBlank()) byId[r.sender_id] = SenderOption(r.sender_id, r.senderName) }
                    st.copy(
                        loading = false,
                        results = list,
                        searched = true,
                        senderOptions = byId.values.sortedBy { it.name },
                    )
                }
            }
            .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("搜索失败")) } }
    }
}
