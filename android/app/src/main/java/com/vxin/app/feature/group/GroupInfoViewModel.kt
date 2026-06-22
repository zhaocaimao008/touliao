package com.vxin.app.feature.group

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.media.MediaUploader
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.util.MediaUrlResolver
import com.vxin.app.data.model.GroupInfo
import com.vxin.app.data.model.GroupMember
import com.vxin.app.data.repository.GroupRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class GroupInfoUiState(
    val loading: Boolean = true,
    val info: GroupInfo? = null,
    val renaming: Boolean = false,
    val updating: Boolean = false,        // 群公告 / 我的群昵称 保存中
    val uploadingAvatar: Boolean = false,
    val left: Boolean = false,      // 已退群/被移出 → UI 关闭返回
    val error: String? = null,
)

@HiltViewModel
class GroupInfoViewModel @Inject constructor(
    private val groupRepository: GroupRepository,
    private val mediaUploader: MediaUploader,
    private val mediaUrlResolver: MediaUrlResolver,
    sessionManager: SessionManager,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val conversationId: String = savedStateHandle.get<String>("conversationId").orEmpty()
    val myId: String = sessionManager.currentUser?.id.orEmpty()

    private val _uiState = MutableStateFlow(GroupInfoUiState())
    val uiState: StateFlow<GroupInfoUiState> = _uiState.asStateFlow()

    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

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

    fun setAnnouncement(text: String) {
        if (_uiState.value.updating) return
        _uiState.update { it.copy(updating = true, error = null) }
        viewModelScope.launch {
            runCatching { groupRepository.setAnnouncement(conversationId, text.trim()) }
                .onSuccess { _uiState.update { s -> s.copy(updating = false, info = s.info?.copy(announcement = text.trim())) } }
                .onFailure { e -> _uiState.update { it.copy(updating = false, error = e.toUserMessage("设置群公告失败")) } }
        }
    }

    fun setNickname(nickname: String) {
        if (_uiState.value.updating) return
        _uiState.update { it.copy(updating = true, error = null) }
        viewModelScope.launch {
            runCatching { groupRepository.setNickname(conversationId, nickname.trim()) }
                .onSuccess {
                    _uiState.update { s ->
                        val members = s.info?.members?.map { if (it.id == myId) it.copy(nickname = nickname.trim().ifBlank { null }) else it }.orEmpty()
                        s.copy(updating = false, info = s.info?.copy(members = members))
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(updating = false, error = e.toUserMessage("设置群昵称失败")) } }
        }
    }

    fun setAvatar(uri: Uri) {
        if (_uiState.value.uploadingAvatar) return
        _uiState.update { it.copy(uploadingAvatar = true, error = null) }
        viewModelScope.launch {
            val prepared = withContext(Dispatchers.IO) {
                runCatching { mediaUploader.prepareFromUri(uri, fieldName = "avatar") }.getOrNull()
            }
            if (prepared == null) {
                _uiState.update { it.copy(uploadingAvatar = false, error = "无法读取图片") }
                return@launch
            }
            runCatching { groupRepository.setAvatar(conversationId, prepared.part) }
                .onSuccess { url -> _uiState.update { s -> s.copy(uploadingAvatar = false, info = s.info?.copy(avatar = url)) } }
                .onFailure { e -> _uiState.update { it.copy(uploadingAvatar = false, error = e.toUserMessage("群头像上传失败")) } }
        }
    }

    fun setRole(member: GroupMember, makeAdmin: Boolean) {
        val role = if (makeAdmin) "admin" else "member"
        viewModelScope.launch {
            runCatching { groupRepository.setRole(conversationId, member.id, role) }
                .onSuccess {
                    _uiState.update { s ->
                        val members = s.info?.members?.map { if (it.id == member.id) it.copy(role = role) else it }.orEmpty()
                        s.copy(info = s.info?.copy(members = members))
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("设置角色失败")) } }
        }
    }

    fun transferOwner(member: GroupMember) {
        viewModelScope.launch {
            runCatching { groupRepository.transferOwner(conversationId, member.id) }
                .onSuccess { refresh() }   // 我已变普通成员，重新拉取刷新权限
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("转让群主失败")) } }
        }
    }

    fun setManage(muteAll: Boolean? = null, noPrivateChat: Boolean? = null, noAddFriend: Boolean? = null) {
        if (_uiState.value.updating) return
        _uiState.update { it.copy(updating = true, error = null) }
        viewModelScope.launch {
            runCatching { groupRepository.manage(conversationId, com.vxin.app.data.model.ManageBody(muteAll, noPrivateChat, noAddFriend)) }
                .onSuccess {
                    _uiState.update { s ->
                        s.copy(updating = false, info = s.info?.copy(
                            mute_all = muteAll?.let { if (it) 1 else 0 } ?: s.info.mute_all,
                            no_private_chat = noPrivateChat?.let { if (it) 1 else 0 } ?: s.info.no_private_chat,
                            no_add_friend = noAddFriend?.let { if (it) 1 else 0 } ?: s.info.no_add_friend,
                        ))
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(updating = false, error = e.toUserMessage("设置失败")) } }
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
