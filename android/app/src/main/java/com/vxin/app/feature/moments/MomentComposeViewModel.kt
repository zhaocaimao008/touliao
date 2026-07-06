package com.vxin.app.feature.moments

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.media.MediaUploader
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.data.repository.MomentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class MomentComposeUiState(
    val content: String = "",
    val images: List<Uri> = emptyList(),
    val visibility: String = "all",   // all | friends | private | include | exclude
    val visibleTo: List<String> = emptyList(),  // include/exclude 选中的好友 id
    val friends: List<com.vxin.app.data.model.Contact> = emptyList(),
    val showFriendPicker: Boolean = false,
    val publishing: Boolean = false,
    val done: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class MomentComposeViewModel @Inject constructor(
    private val momentRepository: MomentRepository,
    private val contactRepository: com.vxin.app.data.repository.ContactRepository,
    private val mediaUploader: MediaUploader,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MomentComposeUiState())
    val uiState: StateFlow<MomentComposeUiState> = _uiState.asStateFlow()

    /** 一次性提示消费：Screen 展示 error 后调用，清空以免常驻 */
    fun consumeError() = _uiState.update { it.copy(error = null) }

    fun onContentChange(v: String) = _uiState.update { it.copy(content = v) }

    fun setVisibility(v: String) {
        _uiState.update { it.copy(visibility = v) }
        if (v == "include" || v == "exclude") {
            ensureFriends()
            _uiState.update { it.copy(showFriendPicker = true) }
        }
    }

    private fun ensureFriends() {
        if (_uiState.value.friends.isNotEmpty()) return
        viewModelScope.launch {
            runCatching { contactRepository.contacts() }
                .onSuccess { list -> _uiState.update { it.copy(friends = list) } }
        }
    }

    fun openFriendPicker() { ensureFriends(); _uiState.update { it.copy(showFriendPicker = true) } }
    fun dismissFriendPicker() = _uiState.update { it.copy(showFriendPicker = false) }
    fun toggleVisibleFriend(id: String) = _uiState.update {
        it.copy(visibleTo = if (it.visibleTo.contains(id)) it.visibleTo - id else it.visibleTo + id)
    }

    fun addImages(uris: List<Uri>) = _uiState.update {
        it.copy(images = (it.images + uris).take(9))
    }
    fun removeImage(uri: Uri) = _uiState.update { it.copy(images = it.images - uri) }

    fun publish() {
        val s = _uiState.value
        if (s.publishing) return
        if (s.content.isBlank() && s.images.isEmpty()) {
            _uiState.update { it.copy(error = "请输入内容或选择图片") }
            return
        }
        if (s.visibility == "include" && s.visibleTo.isEmpty()) {
            _uiState.update { it.copy(error = "请选择至少一位可见的好友", showFriendPicker = true) }
            return
        }
        val visList = if (s.visibility == "include" || s.visibility == "exclude") s.visibleTo else emptyList()
        _uiState.update { it.copy(publishing = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val urls = if (s.images.isEmpty()) emptyList() else {
                    val parts = withContext(Dispatchers.IO) {
                        s.images.mapNotNull { uri -> mediaUploader.prepareFromUri(uri, fieldName = "images")?.part }
                    }
                    momentRepository.uploadImages(parts)
                }
                momentRepository.create(s.content.trim(), urls, s.visibility, visList)
            }
                .onSuccess { _uiState.update { it.copy(publishing = false, done = true) } }
                .onFailure { e -> _uiState.update { it.copy(publishing = false, error = e.toUserMessage("发布失败")) } }
        }
    }
}
