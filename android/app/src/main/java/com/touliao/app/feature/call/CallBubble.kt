package com.touliao.app.feature.call

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.touliao.app.core.call.CallStage
import com.touliao.app.core.call.CallState
import com.touliao.app.core.call.GroupCallStage
import com.touliao.app.core.call.GroupCallState
import com.touliao.app.core.call.GroupRoster
import com.touliao.app.ui.components.InitialAvatar
import com.touliao.app.ui.theme.TouliaoMedia
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import kotlin.math.roundToInt

/**
 * 通话小窗（1v1 与群通话共用）：可拖拽悬浮气泡，默认停靠右上角；拖动跟手，松手停在拖到的位置(不做边缘吸附，
 * 保持简单，对齐iOS CallMinimizedBubble)。[videoTrack] 与 [eglContext] 都不为空时显示视频缩略图，其余显示头像。
 * CALL-1：点击与拖动拆成两个手势。此前只靠 detectDragGestures 的 onDragEnd 判断"位移<阈值"算点击，
 * 但拖动回调要手指先越过 touch slop 才触发，单纯点一下毫无反应，收起后回不到挂断键。
 * 现在外层 pointerInput 只管拖，内层 clickable 管点：拖动越过 slop 会消费事件，clickable 随之取消；
 * 单纯点按则正常触发 clickable，恢复全屏。clickable 同时提供读屏的按钮角色与操作说明。
 * 根节点(fillMaxSize 的 BoxWithConstraints)不挂任何触摸处理，气泡以外的点击照常落到下层页面。
 */
@Composable
internal fun CallBubble(
    description: String,
    avatarName: String,
    showProgress: Boolean,
    videoTrack: VideoTrack?,
    eglContext: EglBase.Context?,
    onClick: () -> Unit,
) {
    val bubbleSizeDp = 64.dp
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val density = LocalDensity.current
        val bubblePx = with(density) { bubbleSizeDp.toPx() }
        val marginPx = bubblePx / 2 + with(density) { 8.dp.toPx() }
        val maxWidthPx = with(density) { maxWidth.toPx() }
        val maxHeightPx = with(density) { maxHeight.toPx() }
        val defaultXPx = maxWidthPx - marginPx
        val defaultYPx = with(density) { 130.dp.toPx() }

        var dragX by remember { mutableStateOf(0f) }
        var dragY by remember { mutableStateOf(0f) }

        val centerX = (defaultXPx + dragX).coerceIn(marginPx, (maxWidthPx - marginPx).coerceAtLeast(marginPx))
        val centerY = (defaultYPx + dragY).coerceIn(marginPx, (maxHeightPx - marginPx).coerceAtLeast(marginPx))

        Box(
            Modifier
                .offset {
                    IntOffset(
                        (centerX - bubblePx / 2).roundToInt(),
                        (centerY - bubblePx / 2).roundToInt(),
                    )
                }
                .size(bubbleSizeDp)
                .clip(RoundedCornerShape(16.dp))
                .background(TouliaoMedia.surface)
                // 外层：只处理拖动(越过 touch slop 后消费事件，内层点击随之取消)
                .pointerInput(Unit) {
                    detectDragGestures { change, amount ->
                        change.consume()
                        dragX += amount.x
                        dragY += amount.y
                    }
                }
                // 内层：单纯点按恢复全屏
                .clickable(role = Role.Button, onClickLabel = "返回通话界面") { onClick() }
                // 读屏只念一句描述，不再逐个念头像首字/加载圈(clickable 在外层，其按钮语义保留)
                .clearAndSetSemantics { contentDescription = description },
            contentAlignment = Alignment.Center,
        ) {
            if (videoTrack != null && eglContext != null) {
                VideoView(
                    track = videoTrack, eglContext = eglContext,
                    mirror = false, modifier = Modifier.fillMaxSize(),
                )
            } else {
                InitialAvatar(name = avatarName, size = bubbleSizeDp)
            }
            if (showProgress) {
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)))
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp,
                )
            }
        }
    }
}

/**
 * 1v1 通话小窗。[eglContext]/[remoteTrack] 只在需要显示对方画面时才调用，
 * 避免语音通话为了画小窗去初始化 EGL。
 */
@Composable
internal fun P2pCallBubble(
    state: CallState,
    eglContext: () -> EglBase.Context,
    remoteTrack: () -> VideoTrack?,
    onClick: () -> Unit,
) {
    val showVideo = state.isVideo && state.remoteVideoActive && state.stage == CallStage.CONNECTED
    CallBubble(
        description = p2pBubbleDescription(state),
        avatarName = state.peerName.ifBlank { "?" },
        showProgress = state.stage != CallStage.CONNECTED,
        videoTrack = if (showVideo) remoteTrack() else null,
        eglContext = if (showVideo) eglContext() else null,
        onClick = onClick,
    )
}

/**
 * 群通话小窗：视频通话接通后显示第一路远端画面，否则显示群头像。
 * 名单只有属于本次通话所在的群时才使用（见 [groupBubbleAvatarName]）。
 */
@Composable
internal fun GroupCallBubble(
    state: GroupCallState,
    roster: GroupRoster,
    remoteTracks: Map<String, VideoTrack>,
    eglContext: () -> EglBase.Context,
    onClick: () -> Unit,
) {
    val track = if (state.isVideo && state.stage == GroupCallStage.CONNECTED) remoteTracks.values.firstOrNull() else null
    CallBubble(
        description = groupBubbleDescription(state),
        avatarName = groupBubbleAvatarName(state, roster),
        showProgress = state.stage != GroupCallStage.CONNECTED,
        videoTrack = track,
        eglContext = if (track != null) eglContext() else null,
        onClick = onClick,
    )
}

/** 1v1 小窗读屏文字（纯函数，JVM 单测覆盖；文案与 CALL-1 起的旧小窗逐字一致，CallMinimizedBubbleTest 依赖它） */
internal fun p2pBubbleDescription(state: CallState): String {
    val peer = state.peerName.ifBlank { "对方" }
    return when (state.stage) {
        CallStage.CONNECTED -> "与${peer}通话中，点按返回"
        CallStage.ENDED -> "与${peer}的通话已结束"
        else -> "正在连接${peer}，点按返回"
    }
}

/** 群通话小窗读屏文字：人数含自己 */
internal fun groupBubbleDescription(state: GroupCallState): String =
    if (state.stage == GroupCallStage.CONNECTED) {
        "群通话中（${state.participants.size + 1}人），点按返回"
    } else {
        "正在加入群通话，点按返回"
    }

/** 群通话小窗头像用的名字：名单属于本次通话所在的群且群名不为空时用群名，否则用"群" */
internal fun groupBubbleAvatarName(state: GroupCallState, roster: GroupRoster): String =
    roster.groupName.takeIf { roster.conversationId == state.conversationId && it.isNotBlank() } ?: "群"
