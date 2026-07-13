package com.vxin.app.feature.profile

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.media.MediaUploader
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.util.MediaUrlResolver
import com.vxin.app.data.model.User
import com.vxin.app.data.repository.ProfileRepository
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
    val changingPassword: Boolean = false,
    val deletingAccount: Boolean = false,
    val changePasswordAllowed: Boolean = true, // 后台「自助修改密码」开关，关闭则隐藏入口
    val message: String? = null,     // 提示（成功/失败）
    val invite: com.vxin.app.data.model.InviteInfo? = null, // 我的专属邀请码+战绩
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val sessionManager: SessionManager,
    private val profileRepository: ProfileRepository,
    private val mediaUploader: MediaUploader,
    private val mediaUrlResolver: MediaUrlResolver,
    private val configApi: com.vxin.app.data.api.ConfigApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState(user = sessionManager.currentUser))
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init { loadInvite(); loadFeatures() }

    /** 拉取后台功能开关，同步「修改密码」入口显隐；失败保持默认开启，不误伤。 */
    private fun loadFeatures() {
        viewModelScope.launch {
            runCatching { configApi.getConfig() }.onSuccess { cfg ->
                _uiState.update { it.copy(changePasswordAllowed = cfg.features.changePassword) }
            }
        }
    }

    /** 拉取我的专属邀请码与邀请战绩；失败静默（不打扰主资料流程）。 */
    fun loadInvite() {
        viewModelScope.launch {
            runCatching { profileRepository.myInvite() }
                .onSuccess { info -> _uiState.update { it.copy(invite = info) } }
        }
    }

    // ── 多账号 ──────────────────────────────────────────
    private val _accounts = MutableStateFlow(sessionManager.accounts())
    val accounts: StateFlow<List<com.vxin.app.data.model.Account>> = _accounts.asStateFlow()
    val activeAccountId: String? get() = sessionManager.activeAccountId()

    fun refreshAccounts() { _accounts.value = sessionManager.accounts() }
    fun switchAccount(id: String) { sessionManager.switchAccount(id) }
    fun removeAccount(id: String) { sessionManager.removeAccount(id); refreshAccounts() }

    fun resolveAvatarUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    fun saveProfile(username: String, bio: String) {
        if (_uiState.value.saving) return
        _uiState.update { it.copy(saving = true, message = null) }
        viewModelScope.launch {
            runCatching { profileRepository.updateProfile(username.trim(), bio) }
                .onSuccess { user ->
                    sessionManager.updateCurrentUser(user)
                    _uiState.update { it.copy(saving = false, user = user, message = "已保存") }
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

    fun changePassword(oldPassword: String, newPassword: String, onDone: (Boolean) -> Unit) {
        if (_uiState.value.changingPassword) return
        _uiState.update { it.copy(changingPassword = true, message = null) }
        viewModelScope.launch {
            runCatching { profileRepository.changePassword(oldPassword, newPassword) }
                .onSuccess { newToken ->
                    // 关键：旧 Bearer token 已被后端拉黑，立即用新 token 覆盖本地，否则下一请求 401 被登出
                    if (!newToken.isNullOrBlank()) sessionManager.applyNewToken(newToken)
                    _uiState.update { it.copy(changingPassword = false, message = "密码已修改") }
                    onDone(true)
                }
                .onFailure { e ->
                    _uiState.update { it.copy(changingPassword = false, message = e.toUserMessage("修改失败")) }
                    onDone(false)
                }
        }
    }

    /** 注销账户：需当前密码确认。成功后清本地登录态回登录页。onDone(true) 表示已注销。 */
    fun deleteAccount(password: String, onDone: (Boolean) -> Unit) {
        if (_uiState.value.deletingAccount) return
        _uiState.update { it.copy(deletingAccount = true, message = null) }
        viewModelScope.launch {
            runCatching { profileRepository.deleteAccount(password) }
                .onSuccess {
                    _uiState.update { it.copy(deletingAccount = false) }
                    sessionManager.deleteAccount()   // 清本地并切到未登录 → 导航自动回登录页
                    onDone(true)
                }
                .onFailure { e ->
                    _uiState.update { it.copy(deletingAccount = false, message = e.toUserMessage("注销失败")) }
                    onDone(false)
                }
        }
    }

    fun logout() {
        viewModelScope.launch { sessionManager.logout() }
    }

    fun clearMessage() = _uiState.update { it.copy(message = null) }
}
