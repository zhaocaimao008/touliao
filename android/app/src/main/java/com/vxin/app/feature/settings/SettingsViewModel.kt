package com.vxin.app.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.storage.ThemeMode
import com.vxin.app.core.storage.ThemeStore
import com.vxin.app.data.model.UpdateSettingsBody
import com.vxin.app.data.model.UserSettings
import com.vxin.app.data.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val loading: Boolean = true,
    val settings: UserSettings = UserSettings(),
    val error: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val profileRepository: ProfileRepository,
    private val themeStore: ThemeStore,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    val themeMode: StateFlow<ThemeMode> = themeStore.mode

    init { load() }

    fun load() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { profileRepository.settings() }
                .onSuccess { s -> _uiState.update { it.copy(loading = false, settings = s) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载设置失败")) } }
        }
    }

    fun setThemeMode(mode: ThemeMode) = themeStore.set(mode)

    /** 乐观更新单个开关：先本地翻转，再提交服务端，失败回滚。 */
    private fun patch(optimistic: (UserSettings) -> UserSettings, body: UpdateSettingsBody) {
        val prev = _uiState.value.settings
        _uiState.update { it.copy(settings = optimistic(it.settings)) }
        viewModelScope.launch {
            runCatching { profileRepository.updateSettings(body) }
                .onSuccess { s -> _uiState.update { it.copy(settings = s) } }
                .onFailure { e -> _uiState.update { it.copy(settings = prev, error = e.toUserMessage("保存失败")) } }
        }
    }

    // 隐私与安全
    fun setAddByVxinId(v: Boolean) = patch({ it.copy(addByVxinId = v) }, UpdateSettingsBody(addByVxinId = v))
    fun setAddByPhone(v: Boolean) = patch({ it.copy(addByPhone = v) }, UpdateSettingsBody(addByPhone = v))
    fun setRequireVerify(v: Boolean) = patch({ it.copy(requireVerify = v) }, UpdateSettingsBody(requireVerify = v))
    fun setNoDirectGroupInvite(v: Boolean) = patch({ it.copy(noDirectGroupInvite = v) }, UpdateSettingsBody(noDirectGroupInvite = v))

    // 通知
    fun setMessageNotify(v: Boolean) = patch({ it.copy(messageNotify = v) }, UpdateSettingsBody(messageNotify = v))
    fun setDetailPreview(v: Boolean) = patch({ it.copy(detailPreview = v) }, UpdateSettingsBody(detailPreview = v))
    fun setSound(v: Boolean) = patch({ it.copy(sound = v) }, UpdateSettingsBody(sound = v))
    fun setVibrate(v: Boolean) = patch({ it.copy(vibrate = v) }, UpdateSettingsBody(vibrate = v))

    fun clearError() = _uiState.update { it.copy(error = null) }
}
