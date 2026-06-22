package com.vxin.app.feature.group

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.GroupQr
import com.vxin.app.data.repository.GroupRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class GroupQrUiState(
    val loading: Boolean = true,
    val qr: GroupQr? = null,
    val error: String? = null,
)

@HiltViewModel
class GroupQrViewModel @Inject constructor(
    private val groupRepository: GroupRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val conversationId: String = savedStateHandle.get<String>("conversationId").orEmpty()

    private val _uiState = MutableStateFlow(GroupQrUiState())
    val uiState: StateFlow<GroupQrUiState> = _uiState.asStateFlow()

    init { load() }

    fun load() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { groupRepository.qrCode(conversationId) }
                .onSuccess { qr -> _uiState.update { it.copy(loading = false, qr = qr) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("二维码加载失败")) } }
        }
    }
}
