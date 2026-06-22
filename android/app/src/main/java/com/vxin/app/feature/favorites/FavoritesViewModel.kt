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
    val items: List<Collection> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val favoritesRepository: FavoritesRepository,
    private val mediaUrlResolver: MediaUrlResolver,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FavoritesUiState())
    val uiState: StateFlow<FavoritesUiState> = _uiState.asStateFlow()

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
                .onSuccess { _uiState.update { s -> s.copy(items = s.items.filterNot { it.id == item.id }) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("取消收藏失败")) } }
        }
    }
}
