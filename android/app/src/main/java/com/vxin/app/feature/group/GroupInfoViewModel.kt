package com.vxin.app.feature.group

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.GroupInfo
import com.vxin.app.data.model.GroupMember
import com.vxin.app.data.repository.GroupRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class GroupInfoUiState(
    val loading: Boolean = true,
    val info: GroupInfo? = null,
    val renaming: Boolean = false,
    val left: Boolean = false,      // 已退群/被移出 → UI 关闭返回
    val error: String? = null,
)

@HiltViewModel
class GroupInfoViewModel @Inject constructor(
    private val groupRepository: GroupRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val conversationId: String = savedStateHandle.get<String>("conversationId").orEmpty()

    private val _uiState = MutableStateFlow(GroupInfoUiState())
    val uiState: StateFlow<GroupInfoUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { groupRepository.info(conversationId) }
                .onSuccess { info -> _uiState.update { it.copy(loading = false, info = info) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载群信息失败")) } }
        }
    }

    fun rename(name: String) {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || _uiState.value.renaming) return
        _uiState.update { it.copy(renaming = true, error = null) }
        viewModelScope.launch {
            runCatching { groupRepository.rename(conversationId, trimmed) }
                .onSuccess {
                    _uiState.update { s -> s.copy(renaming = false, info = s.info?.copy(name = trimmed)) }
                }
                .onFailure { e -> _uiState.update { it.copy(renaming = false, error = e.toUserMessage("改名失败")) } }
        }
    }

    fun kick(member: GroupMember) {
        viewModelScope.launch {
            runCatching { groupRepository.kick(conversationId, member.id) }
                .onSuccess {
                    _uiState.update { s ->
                        s.copy(info = s.info?.copy(members = s.info.members.filterNot { it.id == member.id }))
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("移除失败")) } }
        }
    }

    fun leave() {
        viewModelScope.launch {
            runCatching { groupRepository.leave(conversationId) }
                .onSuccess { _uiState.update { it.copy(left = true) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("退群失败")) } }
        }
    }
}
