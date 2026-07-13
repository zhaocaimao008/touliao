package com.vxin.app.feature.sessions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.api.AuthApi
import com.vxin.app.data.model.DeviceSession
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SessionsUiState(
    val loading: Boolean = true,
    val sessions: List<DeviceSession> = emptyList(),
    val error: String? = null,
    val message: String? = null,
)

@HiltViewModel
class SessionsViewModel @Inject constructor(
    private val authApi: AuthApi,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SessionsUiState())
    val uiState: StateFlow<SessionsUiState> = _uiState.asStateFlow()

    init { load() }

    fun load() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { authApi.sessions() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, sessions = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载失败")) } }
        }
    }

    fun kick(session: DeviceSession) {
        if (session.current) return
        viewModelScope.launch {
            runCatching { authApi.deleteSession(session.id) }
                .onSuccess {
                    _uiState.update { s -> s.copy(sessions = s.sessions.filterNot { it.id == session.id }, message = "已下线该设备") }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("操作失败")) } }
        }
    }

    fun kickOthers() {
        viewModelScope.launch {
            runCatching { authApi.deleteOtherSessions() }
                .onSuccess { _uiState.update { s -> s.copy(sessions = s.sessions.filter { it.current }, message = "已退出其它设备") } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("操作失败")) } }
        }
    }

    fun clearMessage() = _uiState.update { it.copy(message = null) }
}
