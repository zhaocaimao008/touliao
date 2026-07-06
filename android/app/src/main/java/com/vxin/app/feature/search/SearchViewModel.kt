package com.vxin.app.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.SearchResult
import com.vxin.app.data.repository.SearchRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SearchUiState(
    val query: String = "",
    val loading: Boolean = false,
    val results: List<SearchResult> = emptyList(),
    val searched: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchRepository: SearchRepository,
) : ViewModel() {

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

    private suspend fun runSearch(q: String) {
        _uiState.update { it.copy(loading = true, error = null) }
        runCatching { searchRepository.search(q) }
            .onSuccess { list -> _uiState.update { it.copy(loading = false, results = list, searched = true) } }
            .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("搜索失败")) } }
    }
}
