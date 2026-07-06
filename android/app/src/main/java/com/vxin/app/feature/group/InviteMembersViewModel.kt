package com.vxin.app.feature.group

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.Contact
import com.vxin.app.data.repository.ContactRepository
import com.vxin.app.data.repository.GroupRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class InviteMembersUiState(
    val loading: Boolean = true,
    val candidates: List<Contact> = emptyList(),   // 非群成员的联系人
    val selected: Set<String> = emptySet(),
    val inviting: Boolean = false,
    val done: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class InviteMembersViewModel @Inject constructor(
    private val groupRepository: GroupRepository,
    private val contactRepository: ContactRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val conversationId: String = savedStateHandle.get<String>("conversationId").orEmpty()

    private val _uiState = MutableStateFlow(InviteMembersUiState())
    val uiState: StateFlow<InviteMembersUiState> = _uiState.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    init {
        viewModelScope.launch {
            val result = runCatching {
                val contacts = contactRepository.contacts()
                val memberIds = groupRepository.info(conversationId).members.map { it.id }.toSet()
                contacts.filterNot { it.id in memberIds }
            }
            result
                .onSuccess { list -> _uiState.update { it.copy(loading = false, candidates = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载失败")) } }
        }
    }

    fun toggle(id: String) = _uiState.update {
        it.copy(selected = if (id in it.selected) it.selected - id else it.selected + id)
    }

    fun invite() {
        val s = _uiState.value
        if (s.selected.isEmpty() || s.inviting) return
        _uiState.update { it.copy(inviting = true, error = null) }
        viewModelScope.launch {
            runCatching { groupRepository.invite(conversationId, s.selected.toList()) }
                .onSuccess { _uiState.update { it.copy(inviting = false, done = true) } }
                .onFailure { e -> _uiState.update { it.copy(inviting = false, error = e.toUserMessage("邀请失败")) } }
        }
    }
}
