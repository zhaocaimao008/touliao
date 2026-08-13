package com.touliao.app.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.data.model.QrPayload
import com.touliao.app.data.model.SearchUser
import com.touliao.app.data.repository.ContactRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import javax.inject.Inject

import com.touliao.app.data.model.UserDetail

data class AddFriendUiState(
    val query: String = "",
    val searching: Boolean = false,
    val results: List<SearchUser> = emptyList(),
    val sentIds: Set<String> = emptySet(),     // 已发送/已加 的用户 id
    val message: String? = null,               // 提示（成功/失败）
    val searched: Boolean = false,
    /** 扫码后待展示资料卡的用户 id；非 null 时显示资料卡 Bottom Sheet */
    val scannedUserId: String? = null,
    /** 扫码用户的详情（加载中为 null + scannedUserLoading=true） */
    val scannedUserDetail: UserDetail? = null,
    val scannedUserLoading: Boolean = false,
)

@HiltViewModel
class AddFriendViewModel @Inject constructor(
    private val contactRepository: ContactRepository,
    private val groupRepository: com.touliao.app.data.repository.GroupRepository,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AddFriendUiState())
    val uiState: StateFlow<AddFriendUiState> = _uiState.asStateFlow()

    private val json = Json { ignoreUnknownKeys = true }

    /** 扫码结果：vxin 用户码 → 加好友；群邀请链接(/join/TOKEN) → 进群 */
    fun addByQrPayload(raw: String) {
        // 群邀请链接
        if (raw.contains("/join/")) {
            val token = raw.substringAfterLast("/join/").substringBefore("?").substringBefore("/").trim()
            if (token.isNotEmpty()) { joinGroup(token); return }
        }
        val payload = runCatching { json.decodeFromString<QrPayload>(raw) }.getOrNull()
        if (payload == null || payload.type != "vxin-user" || payload.id.isBlank()) {
            _uiState.update { it.copy(message = "无法识别的二维码") }
            return
        }
        if (payload.id == sessionManager.currentUser?.id) {
            _uiState.update { it.copy(message = "这是你自己的二维码") }
            return
        }
        // 先展示资料卡，由用户决定是否发送好友申请
        _uiState.update { it.copy(scannedUserId = payload.id, scannedUserDetail = null, scannedUserLoading = true) }
        viewModelScope.launch {
            runCatching { contactRepository.getUserDetail(payload.id) }
                .onSuccess { detail -> _uiState.update { it.copy(scannedUserDetail = detail, scannedUserLoading = false) } }
                .onFailure { e -> _uiState.update { it.copy(scannedUserLoading = false, message = e.toUserMessage("加载资料失败")) } }
        }
    }

    /** 从资料卡发送好友申请 */
    fun sendRequestFromScanned(userId: String) {
        viewModelScope.launch {
            runCatching { contactRepository.sendFriendRequest(userId, "") }
                .onSuccess { resp ->
                    _uiState.update {
                        it.copy(
                            sentIds = it.sentIds + userId,
                            scannedUserId = null,
                            scannedUserDetail = null,
                            message = if (resp.autoAccepted) "已添加为好友" else "好友申请已发送",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(message = e.toUserMessage("添加失败")) } }
        }
    }

    /** 关闭扫码资料卡 */
    fun dismissScannedUser() = _uiState.update { it.copy(scannedUserId = null, scannedUserDetail = null, scannedUserLoading = false) }

    private fun joinGroup(token: String) {
        viewModelScope.launch {
            runCatching { groupRepository.join(token) }
                .onSuccess { r -> _uiState.update { it.copy(message = if (r.alreadyMember) "你已在该群" else "已加入群聊") } }
                .onFailure { e -> _uiState.update { it.copy(message = e.toUserMessage("进群失败")) } }
        }
    }

    fun onQueryChange(v: String) = _uiState.update { it.copy(query = v, message = null) }

    fun search() {
        val q = _uiState.value.query.trim()
        if (q.isEmpty() || _uiState.value.searching) return
        _uiState.update { it.copy(searching = true, message = null) }
        viewModelScope.launch {
            runCatching { contactRepository.search(q) }
                .onSuccess { list -> _uiState.update { it.copy(searching = false, results = list, searched = true) } }
                .onFailure { e -> _uiState.update { it.copy(searching = false, message = e.toUserMessage("搜索失败")) } }
        }
    }

    fun sendRequest(user: SearchUser) {
        viewModelScope.launch {
            runCatching { contactRepository.sendFriendRequest(user.id, "") }
                .onSuccess { resp ->
                    _uiState.update {
                        it.copy(
                            sentIds = it.sentIds + user.id,
                            message = if (resp.autoAccepted) "已添加为好友" else "好友申请已发送",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(message = e.toUserMessage("发送失败")) } }
        }
    }
}
