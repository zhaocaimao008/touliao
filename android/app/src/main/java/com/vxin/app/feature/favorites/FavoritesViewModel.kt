package com.vxin.app.feature.favorites

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.util.MediaUrlResolver
import com.vxin.app.data.model.Collection
import com.vxin.app.data.repository.FavoritesRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FavoritesUiState(
    val loading: Boolean = true,
    val items: List<Collection> = emptyList(),     // 全量收藏
    val error: String? = null,
    // 搜索
    val query: String = "",
    val typeFilter: String = "",                   // ""=全部 | text|image|file|video
    val searching: Boolean = false,
    val results: List<Collection>? = null,         // null=未搜索(显示全量) | 列表=搜索结果
) {
    /** 当前应展示的列表：搜索态用结果，否则全量(全量也支持类型过滤) */
    val shown: List<Collection>
        get() = results ?: if (typeFilter.isBlank()) items else items.filter { it.type == typeFilter }
}

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val favoritesRepository: FavoritesRepository,
    private val mediaUrlResolver: MediaUrlResolver,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FavoritesUiState())
    val uiState: StateFlow<FavoritesUiState> = _uiState.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    init { refresh() }

    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { favoritesRepository.list() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, items = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载收藏失败")) } }
        }
    }

    fun remove(item: Collection) {
        viewModelScope.launch {
            runCatching { favoritesRepository.remove(item.id) }
                .onSuccess {
                    _uiState.update { s ->
                        s.copy(
                            items = s.items.filterNot { it.id == item.id },
                            results = s.results?.filterNot { it.id == item.id },
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("取消收藏失败")) } }
        }
    }

    // ── 搜索（关键词去抖 + 类型过滤，对齐 web/后端）──
    private var searchJob: kotlinx.coroutines.Job? = null

    fun setQuery(q: String) {
        _uiState.update { it.copy(query = q) }
        runSearch()
    }

    fun setTypeFilter(type: String) {
        _uiState.update { it.copy(typeFilter = type) }
        runSearch()
    }

    private fun runSearch() {
        val kw = _uiState.value.query.trim()
        searchJob?.cancel()
        if (kw.isEmpty()) {
            // 关键词空 → 回到全量(类型过滤由 shown 本地完成)，清搜索态
            _uiState.update { it.copy(results = null, searching = false) }
            return
        }
        _uiState.update { it.copy(searching = true) }
        searchJob = viewModelScope.launch {
            kotlinx.coroutines.delay(300)   // 去抖
            val type = _uiState.value.typeFilter
            runCatching { favoritesRepository.search(kw, type) }
                .onSuccess { list -> _uiState.update { it.copy(searching = false, results = list) } }
                .onFailure { e -> _uiState.update { it.copy(searching = false, results = emptyList(), error = e.toUserMessage("搜索失败")) } }
        }
    }
}
