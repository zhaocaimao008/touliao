package com.touliao.app.feature.call

import androidx.lifecycle.ViewModel
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.call.CallState
import com.touliao.app.core.call.CallUiRules
import com.touliao.app.core.di.AppScope
import com.touliao.app.data.api.MessageApi
import com.touliao.app.data.model.CreatePrivateBody
import com.touliao.app.navigation.PendingConversationHolder
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import javax.inject.Inject

@HiltViewModel
class CallViewModel @Inject constructor(
    private val callManager: CallManager,
    private val api: MessageApi,
    // 拒接后回复：CallActivity 随即 finish，ViewModel 跟着清掉，建会话请求要放在应用级作用域里跑完
    @AppScope private val appScope: CoroutineScope,
) : ViewModel() {

    val state: StateFlow<CallState> = callManager.state
    /** 通话音量=0:回铃音无声时提示用户调高音量 */
    val voiceCallVolumeZero: StateFlow<Boolean> = callManager.voiceCallVolumeZero

    val eglBaseContext: EglBase.Context get() = callManager.eglBase.eglBaseContext
    fun localTrack(): VideoTrack? = callManager.localVideoTrack
    fun remoteTrack(): VideoTrack? = callManager.remoteVideoTrack

    fun startCall(peerId: String, peerName: String, video: Boolean) = callManager.startCall(peerId, peerName, video)
    fun accept() = callManager.accept()
    fun reject() = callManager.reject()

    /**
     * 拒接来电并打开与该用户的私聊会话（WhatsApp 式「拒接后回复」）。
     * 拒接后立即归零：避免回复后结束页闪一下，又被 MainActivity 按"1v1 ENDED"再拉起一次通话页。
     * 托管模式下要等解锁完成才执行到这里，期间来电可能已被对方取消或超时，停在结束页甚至已归零（IDLE）。
     * 所以对端信息由调用方在点按那一刻取快照传进来（[peerId] / [peerName]），不在这里现读状态；
     * 只有当前仍在响的正是这一通来电才拒接，然后归零（consumeEnded 只对 ENDED 生效，不会误伤进行中的通话），
     * 再用快照里的对端打开私聊。不传参数时按当前状态取值，与原来的无参调用行为一致。
     * 会话 id 连同标题、对端 id 交给 [PendingConversationHolder]，由 AppNavigation 跳转（CallActivity 里没有导航）。
     */
    fun rejectAndReply(
        peerId: String = callManager.state.value.peerId,
        peerName: String = callManager.state.value.peerName,
    ) {
        val s = callManager.state.value
        if (s.stage == CallStage.INCOMING && s.peerId == peerId) callManager.reject()
        callManager.consumeEnded()
        if (peerId.isEmpty()) return
        appScope.launch {
            // 会话打开失败静默（用户仍可手动进入会话）
            runCatching { api.createPrivate(CreatePrivateBody(peerId)) }
                .onSuccess { PendingConversationHolder.offer(it.conversationId, peerName, peerId) }
        }
    }
    fun hangup() = callManager.hangup()
    fun toggleVideo() = callManager.toggleVideo()
    fun toggleMic() = callManager.toggleMic()
    fun toggleSpeaker() = callManager.toggleSpeaker()
    fun toggleBluetooth() = callManager.toggleBluetooth()
    /** 权限申请结果回调：授权后补起通话前台服务（未授权时建流阶段会跳过）。 */
    fun onPermissionsResult() = callManager.onPermissionsResult()
    /** 每通电话只申请一次权限：本通第一次调用返回 true（标记在 CallManager，cleanup 时复位）。 */
    fun tryConsumePermissionPrompt(): Boolean = callManager.tryConsumePermissionPrompt()
    fun toggleCamera() = callManager.toggleCamera()
    fun switchCamera() = callManager.switchCamera()
    fun consumeEnded() = callManager.consumeEnded()
    /**
     * 收起/恢复小窗。收起只对进行中的 1v1（拨出/连接中/已接通）生效：托管模式下收起要等解锁完成才执行，
     * 期间通话可能已结束，此时不再写 isMinimized——它只表示"用户主动收起了进行中的通话"（contracts C14），
     * 与 GroupCallManager.setMinimized 的阶段判断一致。恢复（false）不受限制。
     */
    fun setMinimized(minimized: Boolean) {
        if (minimized && !CallUiRules.isP2pActive(callManager.state.value.stage)) return
        callManager.setMinimized(minimized)
    }
}
