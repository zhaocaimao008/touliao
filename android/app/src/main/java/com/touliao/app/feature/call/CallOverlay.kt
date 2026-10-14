package com.touliao.app.feature.call

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.touliao.app.core.call.CallManager
import com.touliao.app.core.call.CallState
import com.touliao.app.core.call.CallUiKind
import com.touliao.app.core.call.CallUiPresence
import com.touliao.app.core.call.CallUiRules
import com.touliao.app.core.call.GroupCallInvite
import com.touliao.app.core.call.GroupCallInviteCoordinator
import com.touliao.app.core.call.GroupCallManager
import com.touliao.app.core.call.GroupCallRoster
import com.touliao.app.core.call.GroupCallStage
import com.touliao.app.core.call.GroupCallState
import com.touliao.app.core.call.GroupRoster
import com.touliao.app.ui.components.FeedbackKind
import com.touliao.app.ui.components.TouliaoFeedback
import com.touliao.app.ui.theme.TouliaoMedia
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import javax.inject.Inject

/**
 * MainActivity 上的通话浮层（CALL-2 / CALL-11）：只读两个通话单例、群名单和邀请协调器，自己不持有通话状态。
 * 全屏通话界面一律由 CallActivity 承载，这里不渲染。
 */
@HiltViewModel
class CallOverlayViewModel @Inject constructor(
    private val callManager: CallManager,
    private val groupCallManager: GroupCallManager,
    groupCallRoster: GroupCallRoster,
    private val inviteCoordinator: GroupCallInviteCoordinator,
) : ViewModel() {
    val callState: StateFlow<CallState> = callManager.state
    val groupState: StateFlow<GroupCallState> = groupCallManager.state
    val groupRemoteTracks: StateFlow<Map<String, VideoTrack>> = groupCallManager.remoteTracks
    val roster: StateFlow<GroupRoster> = groupCallRoster.state
    val invite: StateFlow<GroupCallInvite?> = inviteCoordinator.invite
    val callUiStarted: StateFlow<Boolean> = CallUiPresence.callUiStarted

    // EGL/轨道按需取：只有小窗真要显示视频时才调用，语音通话不为画小窗去初始化 EGL
    fun p2pEglContext(): EglBase.Context = callManager.eglBase.eglBaseContext
    fun p2pRemoteTrack(): VideoTrack? = callManager.remoteVideoTrack
    fun groupEglContext(): EglBase.Context = groupCallManager.eglBase.eglBaseContext

    /** 返回 null 表示已发起加入；非 null 是给用户看的中文提示（如邀请已过期） */
    fun joinInvite(i: GroupCallInvite): String? = inviteCoordinator.join(i)
    fun ignoreInvite(i: GroupCallInvite) = inviteCoordinator.dismiss(i.callId)
    fun consumeGroupEnded() = groupCallManager.consumeEnded()
}

/**
 * 应用内通话浮层（挂在 AppNavigation 上，替代原来的 CallHost / GroupCallHost）：
 * 1. 收起后的小窗（1v1 优先，见 CallUiRules.bubbleKind），点按回到 CallActivity；
 * 2. 群通话邀请横幅（加入 / 忽略），数据来自 GroupCallInviteCoordinator，切换页面、重建 Activity 都不会丢；
 * 3. 群通话在小窗状态下结束、CallActivity 不在前台时，没有 GroupCallHost 消费结束态，这里直接归零。
 * 根布局不挂任何触摸处理，只有小窗和横幅按钮自己可点，其余点击照常落到下层页面。
 */
@Composable
fun CallOverlay(viewModel: CallOverlayViewModel = hiltViewModel()) {
    val call by viewModel.callState.collectAsStateWithLifecycle()
    val group by viewModel.groupState.collectAsStateWithLifecycle()
    val groupRemoteTracks by viewModel.groupRemoteTracks.collectAsStateWithLifecycle()
    val roster by viewModel.roster.collectAsStateWithLifecycle()
    val invite by viewModel.invite.collectAsStateWithLifecycle()
    val callUiStarted by viewModel.callUiStarted.collectAsStateWithLifecycle()
    val context = LocalContext.current

    if (group.stage == GroupCallStage.ENDED && !callUiStarted) {
        LaunchedEffect(group.callId) { viewModel.consumeGroupEnded() }
    }

    Box(Modifier.fillMaxSize()) {
        when (CallUiRules.bubbleKind(call, group)) {
            CallUiKind.P2P -> {
                // 小窗显示期间保持常亮（按 View 计数，只影响 MainActivity 自己的窗口）
                KeepScreenOnDuringCall()
                P2pCallBubble(call, { viewModel.p2pEglContext() }, { viewModel.p2pRemoteTrack() }) {
                    CallActivity.open(context)
                }
            }
            CallUiKind.GROUP -> {
                KeepScreenOnDuringCall()
                GroupCallBubble(group, roster, groupRemoteTracks, { viewModel.groupEglContext() }) {
                    CallActivity.open(context)
                }
            }
            CallUiKind.NONE -> Unit
        }

        invite?.let { inv ->
            GroupCallInviteBanner(
                inv,
                onJoin = {
                    viewModel.joinInvite(inv)?.let { msg -> TouliaoFeedback.show(context, msg, FeedbackKind.ERROR) }
                },
                onIgnore = { viewModel.ignoreInvite(inv) },
            )
        }
    }
}

/** 群通话邀请横幅：顶部居中，读屏以礼貌方式播报新邀请；横幅本身不拦截点击，只有两个按钮可点 */
@Composable
private fun GroupCallInviteBanner(invite: GroupCallInvite, onJoin: () -> Unit, onIgnore: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().systemBarsPadding().padding(top = 60.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        contentAlignment = Alignment.TopCenter,
    ) {
        Row(
            Modifier.clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.avatar)).background(TouliaoMedia.surface).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "${invite.fromName.ifBlank { "群成员" }} 发起了群${if (invite.isVideo) "视频" else "语音"}通话",
                color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.base, modifier = Modifier.weight(1f),
            )
            Box(
                Modifier.clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.thumb)).background(TouliaoMedia.accept)
                    .clickable(role = Role.Button) { onJoin() }
                    .heightIn(min = 44.dp).padding(horizontal = 14.dp, vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) { Text("加入", color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2) }
            Box(
                Modifier.clickable(role = Role.Button) { onIgnore() }
                    .heightIn(min = 44.dp).padding(horizontal = 8.dp, vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) { Text("忽略", color = TouliaoMedia.secondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2) }
        }
    }
}
