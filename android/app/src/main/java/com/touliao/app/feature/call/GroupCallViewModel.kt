package com.touliao.app.feature.call

import androidx.lifecycle.ViewModel
import com.touliao.app.core.call.GroupCallManager
import com.touliao.app.core.call.GroupCallRoster
import com.touliao.app.core.call.GroupCallState
import com.touliao.app.core.call.GroupRoster
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import javax.inject.Inject

@HiltViewModel
class GroupCallViewModel @Inject constructor(
    private val groupCallManager: GroupCallManager,
    groupCallRoster: GroupCallRoster,
) : ViewModel() {
    val state: StateFlow<GroupCallState> = groupCallManager.state
    val remoteTracks: StateFlow<Map<String, VideoTrack>> = groupCallManager.remoteTracks
    /** 当前/最近一次群通话所在群的成员名单；使用前须先比对 conversationId（contracts C6） */
    val roster: StateFlow<GroupRoster> = groupCallRoster.state

    val eglBaseContext: EglBase.Context get() = groupCallManager.eglBase.eglBaseContext
    fun localTrack(): VideoTrack? = groupCallManager.localVideoTrack

    fun start(conversationId: String, video: Boolean) = groupCallManager.start(conversationId, video)
    fun join(callId: String, conversationId: String, video: Boolean) = groupCallManager.join(callId, conversationId, video)
    fun hangup() = groupCallManager.hangup()
    fun toggleMic() = groupCallManager.toggleMic()
    fun toggleCamera() = groupCallManager.toggleCamera()
    fun switchCamera() = groupCallManager.switchCamera()
    fun toggleSpeaker() = groupCallManager.toggleSpeaker()
    fun toggleBluetooth() = groupCallManager.toggleBluetooth()
    /** 权限申请结果回调：授权后补起通话前台服务 + 刷新蓝牙可用性。 */
    fun onPermissionsResult() = groupCallManager.onPermissionsResult()
    /** 每通电话只申请一次权限：本通第一次调用返回 true（标记在 GroupCallManager，cleanup 时复位）。 */
    fun tryConsumePermissionPrompt(): Boolean = groupCallManager.tryConsumePermissionPrompt()
    /** 收起/恢复群通话小窗（只在连接中/通话中生效，见 GroupCallManager.setMinimized） */
    fun setMinimized(m: Boolean) = groupCallManager.setMinimized(m)
    fun consumeEnded() = groupCallManager.consumeEnded()
}
