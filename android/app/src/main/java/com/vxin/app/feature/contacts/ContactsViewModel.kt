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
data class ConversationTarget(val conversationId: String, val title: String, val peerUserId: String = "")

data class ContactsUiState(
    val loading: Boolean = false,
    val contacts: List<Contact> = emptyList(),
    val onlineIds: Set<String> = emptySet(),
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

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    init {
        refresh()
        viewModelScope.launch { contactRepository.friendEvents.collect { refresh() } }
        viewModelScope.launch {
            contactRepository.presenceEvents.collect { e ->
                _uiState.update { s ->
                    s.copy(onlineIds = if (e.online) s.onlineIds + e.userId else s.onlineIds - e.userId)
                }
            }
        }
    }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { contactRepository.contacts() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, contacts = list, onlineIds = list.filter { c -> c.status == "online" }.map { c -> c.id }.toSet()) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载联系人失败")) } }
            runCatching { contactRepository.receivedRequests().size }
                .onSuccess { n -> _uiState.update { it.copy(requestCount = n) } }
        }
    }

    fun startPrivateChat(contact: Contact) {
        viewModelScope.launch {
            runCatching { contactRepository.createPrivate(contact.id) }
                .onSuccess { convId -> _openChat.value = ConversationTarget(convId, contact.displayName, contact.id) }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("发起聊天失败")) } }
        }
    }

    fun consumeOpenChat() { _openChat.value = null }

    // ── 好友管理：备注/删除/拉黑 ──
    fun setRemark(contact: Contact, remark: String) {
        viewModelScope.launch {
            runCatching { contactRepository.setRemark(contact.id, remark.trim()) }
                .onSuccess {
                    _uiState.update { s ->
                        s.copy(contacts = s.contacts.map { if (it.id == contact.id) it.copy(remark = remark.trim().ifBlank { null }) else it })
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("设置备注失败")) } }
        }
    }

    fun deleteContact(contact: Contact) {
        viewModelScope.launch {
            runCatching { contactRepository.deleteContact(contact.id) }
                .onSuccess { _uiState.update { s -> s.copy(contacts = s.contacts.filterNot { it.id == contact.id }) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("删除好友失败")) } }
        }
    }

    fun block(contact: Contact) {
        viewModelScope.launch {
            runCatching { contactRepository.block(contact.id) }
                .onSuccess { _uiState.update { s -> s.copy(contacts = s.contacts.filterNot { it.id == contact.id }, error = "已加入黑名单") } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("拉黑失败")) } }
        }
    }
}
