package com.vxin.app.feature.labels

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.Contact
import com.vxin.app.data.model.FriendLabel
import com.vxin.app.data.repository.ContactRepository
import com.vxin.app.data.repository.FriendLabelRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FriendLabelsUiState(
    val loading: Boolean = true,
    val labels: List<FriendLabel> = emptyList(),
    val contacts: List<Contact> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class FriendLabelsViewModel @Inject constructor(
    private val repo: FriendLabelRepository,
    private val contactRepository: ContactRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(FriendLabelsUiState())
    val uiState: StateFlow<FriendLabelsUiState> = _uiState.asStateFlow()

    init { load() }

    fun load() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val labels = repo.list()
                val contacts = runCatching { contactRepository.contacts() }.getOrDefault(emptyList())
                labels to contacts
            }.onSuccess { (labels, contacts) ->
                _uiState.update { it.copy(loading = false, labels = labels, contacts = contacts) }
            }.onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载失败")) } }
        }
    }

    fun createLabel(name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            runCatching { repo.create(name.trim()) }
                .onSuccess { load() }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("创建失败")) } }
        }
    }

    fun deleteLabel(id: String) {
        viewModelScope.launch {
            runCatching { repo.delete(id) }
                .onSuccess { _uiState.update { s -> s.copy(labels = s.labels.filterNot { it.id == id }) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("删除失败")) } }
        }
    }

    fun toggleMember(labelId: String, friendId: String, add: Boolean) {
        viewModelScope.launch {
            runCatching { if (add) repo.addMember(labelId, friendId) else repo.removeMember(labelId, friendId) }
                .onSuccess { load() }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("操作失败")) } }
        }
    }
}
