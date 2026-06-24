package com.vxin.app.feature.call

import androidx.lifecycle.ViewModel
import com.vxin.app.core.call.GroupCallManager
import com.vxin.app.core.call.GroupCallState
import com.vxin.app.core.realtime.GroupCallInviteEvent
import com.vxin.app.core.realtime.SocketManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import javax.inject.Inject

@HiltViewModel
class GroupCallViewModel @Inject constructor(
    private val groupCallManager: GroupCallManager,
    socketManager: SocketManager,
) : ViewModel() {
    val state: StateFlow<GroupCallState> = groupCallManager.state
    val remoteTracks: StateFlow<Map<String, VideoTrack>> = groupCallManager.remoteTracks
    val inviteEvents: SharedFlow<GroupCallInviteEvent> = socketManager.groupCallInviteEvents

    val eglBaseContext: EglBase.Context get() = groupCallManager.eglBase.eglBaseContext
    fun localTrack(): VideoTrack? = groupCallManager.localVideoTrack

    fun start(conversationId: String, video: Boolean) = groupCallManager.start(conversationId, video)
    fun join(callId: String, conversationId: String, video: Boolean) = groupCallManager.join(callId, conversationId, video)
    fun hangup() = groupCallManager.hangup()
    fun toggleMic() = groupCallManager.toggleMic()
    fun toggleCamera() = groupCallManager.toggleCamera()
    fun switchCamera() = groupCallManager.switchCamera()
    fun consumeEnded() = groupCallManager.consumeEnded()
}
