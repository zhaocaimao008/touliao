package com.vxin.app.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.model.Contact
import com.vxin.app.data.repository.ContactRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 新建/打开会话的目标，供 UI 跳转到聊天页 */
data class ConversationTarget(val conversationId: String, val title: String)

data class ContactsUiState(
    val loading: Boolean = false,
    val contacts: List<Contact> = emptyList(),
    val requestCount: Int = 0,
    val error: String? = null,
)

@HiltViewModel
class ContactsViewModel @Inject constructor(
    private val contactRepository: ContactRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ContactsUiState(loading = true))
    val uiState: StateFlow<ContactsUiState> = _uiState.asStateFlow()

    private val _openChat = MutableStateFlow<ConversationTarget?>(null)
    val openChat: StateFlow<ConversationTarget?> = _openChat.asStateFlow()

    init { refresh() }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { contactRepository.contacts() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, contacts = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载联系人失败")) } }
            runCatching { contactRepository.receivedRequests().size }
                .onSuccess { n -> _uiState.update { it.copy(requestCount = n) } }
        }
    }

    fun startPrivateChat(contact: Contact) {
        viewModelScope.launch {
            runCatching { contactRepository.createPrivate(contact.id) }
                .onSuccess { convId -> _openChat.value = ConversationTarget(convId, contact.displayName) }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("发起聊天失败")) } }
        }
    }

    fun consumeOpenChat() { _openChat.value = null }
}
