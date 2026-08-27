package com.touliao.app.feature.profile

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.auth.SessionManager
import com.touliao.app.core.media.MediaUploader
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.core.util.MediaUrlResolver
import com.touliao.app.data.model.User
import com.touliao.app.data.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class ProfileUiState(
    val user: User? = null,
    val saving: Boolean = false,
    val uploadingAvatar: Boolean = false,
    val message: String? = null,     // 提示（成功/失败）
    val invite: com.touliao.app.data.model.InviteInfo? = null, // 我的专属邀请码+战绩
    val changingPhone: Boolean = false,  // 换绑手机号进行中
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val sessionManager: SessionManager,
    private val profileRepository: ProfileRepository,
    private val mediaUploader: MediaUploader,
    private val mediaUrlResolver: MediaUrlResolver,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState(user = sessionManager.currentUser))
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init { loadInvite() }

    /** 拉取我的专属邀请码与邀请战绩；失败静默（不打扰主资料流程）。 */
    fun loadInvite() {
        viewModelScope.launch {
            runCatching { profileRepository.myInvite() }
                .onSuccess { info -> _uiState.update { it.copy(invite = info) } }
        }
    }

    // ── 多账号 ──────────────────────────────────────────
    private val _accounts = MutableStateFlow(sessionManager.accounts())
    val accounts: StateFlow<List<com.touliao.app.data.model.Account>> = _accounts.asStateFlow()
    val activeAccountId: String? get() = sessionManager.activeAccountId()

    fun refreshAccounts() { _accounts.value = sessionManager.accounts() }
    fun switchAccount(id: String) { sessionManager.switchAccount(id) }
    fun removeAccount(id: String) { sessionManager.removeAccount(id); refreshAccounts() }

    /** 编辑资料页返回后重新同步当前用户（对齐母版 refreshUser 行为）。 */
    fun refreshUser() {
        _uiState.update { it.copy(user = sessionManager.currentUser) }
    }

    fun resolveAvatarUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    fun saveProfile(username: String, bio: String) {
        if (_uiState.value.saving) return
        _uiState.update { it.copy(saving = true, message = null) }
        viewModelScope.launch {
            runCatching { profileRepository.updateProfile(username.trim(), bio) }
                .onSuccess { user ->
                    // 后端 /users/profile 返回行不含 phone，整体替换会清空本地手机号，故合并保留
                    val merged = if (user.phone.isBlank()) user.copy(phone = sessionManager.currentUser?.phone ?: "") else user
                    sessionManager.updateCurrentUser(merged)
                    _uiState.update { it.copy(saving = false, user = merged, message = "已保存") }
                }
                .onFailure { e -> _uiState.update { it.copy(saving = false, message = e.toUserMessage("保存失败")) } }
        }
    }

    fun uploadAvatar(uri: Uri) {
        if (_uiState.value.uploadingAvatar) return
        _uiState.update { it.copy(uploadingAvatar = true, message = null) }
        viewModelScope.launch {
            val prepared = withContext(Dispatchers.IO) {
                runCatching { mediaUploader.prepareFromUri(uri, fieldName = "avatar") }.getOrNull()
            }
            if (prepared == null) {
                _uiState.update { it.copy(uploadingAvatar = false, message = "无法读取图片") }
                return@launch
            }
            runCatching { profileRepository.uploadAvatar(prepared.part) }
                .onSuccess { avatarUrl ->
                    val updated = _uiState.value.user?.copy(avatar = avatarUrl)
                    if (updated != null) sessionManager.updateCurrentUser(updated)
                    _uiState.update { it.copy(uploadingAvatar = false, user = updated, message = "头像已更新") }
                }
                .onFailure { e -> _uiState.update { it.copy(uploadingAvatar = false, message = e.toUserMessage("头像上传失败")) } }
        }
    }

    fun logout() {
        viewModelScope.launch { sessionManager.logout() }
    }

    fun clearMessage() = _uiState.update { it.copy(message = null) }

    /** 换绑手机号：新手机号 + 当前登录密码。成功后本地更新手机号并 toast。 */
    fun changePhone(newPhone: String, password: String) {
        if (_uiState.value.changingPhone) return
        _uiState.update { it.copy(changingPhone = true, message = null) }
        viewModelScope.launch {
            runCatching { profileRepository.updatePhone(newPhone.trim(), password) }
                .onSuccess {
                    val updated = _uiState.value.user?.copy(phone = newPhone.trim())
                    if (updated != null) sessionManager.updateCurrentUser(updated)
                    _uiState.update { it.copy(changingPhone = false, user = updated, message = "手机号已更新") }
                }
                .onFailure { e -> _uiState.update { it.copy(changingPhone = false, message = e.toUserMessage("换绑失败")) } }
        }
    }
}
