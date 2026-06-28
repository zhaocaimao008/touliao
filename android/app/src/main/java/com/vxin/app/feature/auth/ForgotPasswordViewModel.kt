package com.vxin.app.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ForgotPasswordUiState(
    val phone: String = "",
    val inviteCode: String = "",
    val newPassword: String = "",
    val confirmPassword: String = "",
    val loading: Boolean = false,
    val success: Boolean = false,
    val error: String? = null,
) {
    private val passwordOk = newPassword.length >= 8 &&
        newPassword.any { it.isLetter() } &&
        newPassword.any { it.isDigit() }

    val canSubmit: Boolean get() =
        phone.isNotBlank() &&
            inviteCode.length == 6 &&
            passwordOk &&
            newPassword == confirmPassword &&
            !loading
}

@HiltViewModel
class ForgotPasswordViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ForgotPasswordUiState())
    val uiState: StateFlow<ForgotPasswordUiState> = _uiState.asStateFlow()

    fun onPhoneChange(v: String) = _uiState.update { it.copy(phone = v, error = null) }
    fun onInviteCodeChange(v: String) = _uiState.update { it.copy(inviteCode = v.filter(Char::isDigit).take(6), error = null) }
    fun onNewPasswordChange(v: String) = _uiState.update { it.copy(newPassword = v, error = null) }
    fun onConfirmPasswordChange(v: String) = _uiState.update { it.copy(confirmPassword = v, error = null) }

    fun submit() {
        val s = _uiState.value
        if (!s.canSubmit) return
        if (s.newPassword != s.confirmPassword) {
            _uiState.update { it.copy(error = "两次输入的密码不一致") }
            return
        }
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                authRepository.resetPassword(s.phone, s.inviteCode, s.newPassword)
            }.onSuccess {
                _uiState.update { it.copy(loading = false, success = true) }
            }.onFailure { e ->
                _uiState.update { it.copy(loading = false, error = e.toUserMessage("重置失败")) }
            }
        }
    }
}