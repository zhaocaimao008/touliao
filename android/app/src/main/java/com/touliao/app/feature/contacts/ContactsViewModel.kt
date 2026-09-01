package com.touliao.app.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.core.util.MediaUrlResolver
import com.touliao.app.data.model.AiAssistant
import com.touliao.app.data.model.Contact
import com.touliao.app.data.repository.ContactRepository
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
    val aiBots: List<AiAssistant> = emptyList(), // AI 助手入口列表（/api/config）
    val showAiBots: Boolean = false,             // 通讯录「AI 助手」展开态
)

@HiltViewModel
class ContactsViewModel @Inject constructor(
    private val contactRepository: ContactRepository,
    private val mediaUrlResolver: MediaUrlResolver,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ContactsUiState(loading = true))
    val uiState: StateFlow<ContactsUiState> = _uiState.asStateFlow()

    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

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
            // AI 助手列表：拉取失败静默保持空（隐藏分组）
            runCatching { contactRepository.fetchAiAssistants() }
                .onSuccess { bots -> _uiState.update { it.copy(aiBots = bots) } }
        }
    }

    fun startPrivateChat(contact: Contact) {
        viewModelScope.launch {
            runCatching { contactRepository.createPrivate(contact.id) }
                .onSuccess { convId -> _openChat.value = ConversationTarget(convId, contact.displayName, contact.id) }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("发起聊天失败")) } }
        }
    }

    /** 展开/收起 AI 助手列表 */
    fun toggleAiBots() = _uiState.update { it.copy(showAiBots = !it.showAiBots) }

    /** 点击 AI 助手卡片 → 打开与 bot 的私聊 */
    fun startAiChat(bot: AiAssistant) {
        viewModelScope.launch {
            runCatching { contactRepository.createPrivate(bot.id) }
                .onSuccess { convId -> _openChat.value = ConversationTarget(convId, bot.name.ifBlank { bot.username }, bot.id) }
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
