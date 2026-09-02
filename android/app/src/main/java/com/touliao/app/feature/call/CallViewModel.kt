package com.touliao.app.feature.call

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallState
import com.touliao.app.data.api.MessageApi
import com.touliao.app.data.model.CreatePrivateBody
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import javax.inject.Inject

@HiltViewModel
class CallViewModel @Inject constructor(
    private val callManager: CallManager,
    private val api: MessageApi,
) : ViewModel() {

    val state: StateFlow<CallState> = callManager.state
    /** 通话音量=0:回铃音无声时提示用户调高音量 */
    val voiceCallVolumeZero: StateFlow<Boolean> = callManager.voiceCallVolumeZero

    /** 拒接后回复消息：发出 (conversationId, peerUserId, peerName) 供 UI 导航到该会话 */
    private val _replyNavigation = MutableSharedFlow<Triple<String, String, String>>(extraBufferCapacity = 1)
    val replyNavigation: SharedFlow<Triple<String, String, String>> = _replyNavigation

    val eglBaseContext: EglBase.Context get() = callManager.eglBase.eglBaseContext
    fun localTrack(): VideoTrack? = callManager.localVideoTrack
    fun remoteTrack(): VideoTrack? = callManager.remoteVideoTrack

    fun startCall(peerId: String, peerName: String, video: Boolean) = callManager.startCall(peerId, peerName, video)
    fun accept() = callManager.accept()
    fun reject() = callManager.reject()

    /** 拒接来电并打开与该用户的私聊会话（WhatsApp 式「拒接后回复」） */
    fun rejectAndReply() {
        val s = callManager.state.value
        callManager.reject()
        if (s.peerId.isEmpty()) return
        viewModelScope.launch {
            try {
                val resp = api.createPrivate(CreatePrivateBody(s.peerId))
                _replyNavigation.tryEmit(Triple(resp.conversationId, s.peerId, s.peerName))
            } catch (_: Exception) {
                // 会话打开失败静默（用户仍可手动进入会话）
            }
        }
    }
    fun hangup() = callManager.hangup()
    fun toggleVideo() = callManager.toggleVideo()
    fun toggleMic() = callManager.toggleMic()
    fun toggleSpeaker() = callManager.toggleSpeaker()
    fun toggleBluetooth() = callManager.toggleBluetooth()
    fun toggleCamera() = callManager.toggleCamera()
    fun switchCamera() = callManager.switchCamera()
    fun consumeEnded() = callManager.consumeEnded()
    fun setMinimized(minimized: Boolean) = callManager.setMinimized(minimized)
}
