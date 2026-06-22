package com.vxin.app.feature.call

import androidx.lifecycle.ViewModel
import com.vxin.app.core.call.CallManager
import com.vxin.app.core.call.CallState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import javax.inject.Inject

@HiltViewModel
class CallViewModel @Inject constructor(
    private val callManager: CallManager,
) : ViewModel() {

    val state: StateFlow<CallState> = callManager.state

    val eglBaseContext: EglBase.Context get() = callManager.eglBase.eglBaseContext
    fun localTrack(): VideoTrack? = callManager.localVideoTrack
    fun remoteTrack(): VideoTrack? = callManager.remoteVideoTrack

    fun startCall(peerId: String, peerName: String, video: Boolean) = callManager.startCall(peerId, peerName, video)
    fun accept() = callManager.accept()
    fun reject() = callManager.reject()
    fun hangup() = callManager.hangup()
    fun toggleMic() = callManager.toggleMic()
    fun toggleCamera() = callManager.toggleCamera()
    fun switchCamera() = callManager.switchCamera()
    fun consumeEnded() = callManager.consumeEnded()
}
