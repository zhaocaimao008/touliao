package com.vxin.app.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.util.MediaUrlResolver
import com.vxin.app.data.model.Contact
import com.vxin.app.data.repository.ContactRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CreateGroupUiState(
    val loading: Boolean = false,
    val contacts: List<Contact> = emptyList(),
    val selected: Set<String> = emptySet(),
    val name: String = "",
    val creating: Boolean = false,
    val error: String? = null,
) {
    val canCreate: Boolean get() = selected.isNotEmpty() && !creating
}

@HiltViewModel
class CreateGroupViewModel @Inject constructor(
    private val contactRepository: ContactRepository,
    private val mediaUrlResolver: MediaUrlResolver,
) : ViewModel() {

    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    private val _uiState = MutableStateFlow(CreateGroupUiState(loading = true))
    val uiState: StateFlow<CreateGroupUiState> = _uiState.asStateFlow()

    private val _created = MutableStateFlow<ConversationTarget?>(null)
    val created: StateFlow<ConversationTarget?> = _created.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    init {
        viewModelScope.launch {
            runCatching { contactRepository.contacts() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, contacts = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载联系人失败")) } }
        }
    }

    fun onNameChange(v: String) = _uiState.update { it.copy(name = v) }

    fun toggle(contactId: String) = _uiState.update {
        it.copy(selected = if (contactId in it.selected) it.selected - contactId else it.selected + contactId)
    }

    fun create() {
        val s = _uiState.value
        if (!s.canCreate) return
        // 群名默认用成员名拼接
        val name = s.name.trim().ifEmpty {
            s.contacts.filter { it.id in s.selected }.joinToString("、") { it.displayName }.take(20)
        }
        _uiState.update { it.copy(creating = true, error = null) }
        viewModelScope.launch {
            runCatching { contactRepository.createGroup(name, s.selected.toList()) }
                .onSuccess { convId -> _created.value = ConversationTarget(convId, name) }
                .onFailure { e -> _uiState.update { it.copy(creating = false, error = e.toUserMessage("创建群聊失败")) } }
        }
    }

    fun consumeCreated() { _created.value = null }
}
