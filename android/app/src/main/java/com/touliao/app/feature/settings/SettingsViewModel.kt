package com.touliao.app.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.network.toUserMessage
import com.touliao.app.core.storage.ThemeMode
import com.touliao.app.core.storage.ThemeStore
import com.touliao.app.data.model.UpdateSettingsBody
import com.touliao.app.data.model.UserSettings
import com.touliao.app.data.repository.ProfileRepository
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
    private val socialSocket: com.touliao.app.core.realtime.SocketManager,
    private val socialTokens: com.touliao.app.core.storage.TokenStore,
    private val profileRepository: ProfileRepository,
    private val themeStore: ThemeStore,
    private val callManager: CallManager,
) : ViewModel() {
    private val socialGuard = com.touliao.app.core.realtime.SocialReadGuard(
        { socialTokens.snapshot().identityEpoch }, { socialSocket.socialRevision.value })
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    val themeMode: StateFlow<ThemeMode> = themeStore.mode

    init {
        viewModelScope.launch { socialSocket.socialRevision.collect { load() } }
    }

    fun load() {
        val stamp = socialGuard.begin() ?: return
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { profileRepository.settings() }
                .onSuccess { s -> if (!socialGuard.current(stamp)) return@onSuccess; _uiState.update { it.copy(loading = false, settings = s) } }
                .onFailure { e -> if (!socialGuard.current(stamp)) return@onFailure; _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载设置失败")) } }
        }
    }

    fun setThemeMode(mode: ThemeMode) = themeStore.set(mode)

    /** 保存后重读真值，迟到的写响应不能覆盖其他端更新。 */
    private fun patch(optimistic: (UserSettings) -> UserSettings, body: UpdateSettingsBody) {
        val prev = _uiState.value.settings
        val owner = socialTokens.snapshot().identityEpoch
        val revision = socialSocket.socialRevision.value
        _uiState.update { it.copy(settings = optimistic(it.settings)) }
        viewModelScope.launch {
            runCatching { profileRepository.updateSettings(body) }
                .onSuccess { load() }
                .onFailure { e ->
                    if (socialTokens.snapshot().identityEpoch != owner) return@onFailure
                    if (socialSocket.socialRevision.value != revision) load()
                    _uiState.update { it.copy(
                        settings = if (socialSocket.socialRevision.value == revision) prev else it.settings,
                        error = e.toUserMessage("保存失败"),
                    ) }
                }
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

    // 勿扰时段：开关切换（乐观更新）
    fun setQuietEnabled(enabled: Boolean) =
        patch(
            { it.copy(quietEnabled = if (enabled) 1 else 0) },
            UpdateSettingsBody(quietEnabled = if (enabled) 1 else 0),
        )

    /** 保存勿扰时段时间（start/end 格式 HH:MM，支持跨夜如 23:00-07:00）。 */
    fun saveQuietTime(start: String, end: String) =
        patch(
            { it.copy(quietStart = start, quietEnd = end) },
            UpdateSettingsBody(quietStart = start, quietEnd = end),
        )

    // 来电铃声：classic/dual/triple/soft，切换即写入 CallManager 生效
    fun setRingtone(key: String) {
        callManager.incomingRingtone = key
        patch({ it.copy(ringtone = key) }, UpdateSettingsBody(ringtone = key))
    }

    fun clearError() = _uiState.update { it.copy(error = null) }
}
