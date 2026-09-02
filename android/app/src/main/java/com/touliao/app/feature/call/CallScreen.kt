package com.touliao.app.feature.call

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.roundToInt
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.touliao.app.core.call.CallStage
import com.touliao.app.ui.components.InitialAvatar
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

private val CallGreen = com.touliao.app.ui.theme.VxinSuccess   // 接听绿=语义成功色，对齐 web --color-success
private val CallRed = Color(0xFFFA5151)

/** 全局通话浮层：通话激活时覆盖在主界面之上 */
@Composable
fun CallHost(
    navController: androidx.navigation.NavHostController? = null,
    viewModel: CallViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // 拒接后回复消息：取/建私聊会话成功 → 导航打开
    LaunchedEffect(Unit) {
        viewModel.replyNavigation.collect { (conversationId, peerUserId, title) ->
            navController?.navigate(com.touliao.app.navigation.Routes.chat(conversationId, title, "private", peerUserId))
        }
    }
    if (state.stage == CallStage.IDLE) return

    // 回铃音无声提示：通话音量=0 时 ToneGenerator 不发声，用户会以为 App 坏了。
    // 只在主叫等待期(calling)显示；音量恢复或接通后自动消失。
    val voiceVolumeZero by viewModel.voiceCallVolumeZero.collectAsStateWithLifecycle()
    val showVolumeHint = voiceVolumeZero &&
        (state.stage == CallStage.OUTGOING || state.stage == CallStage.CONNECTING)

    // 结束态：短暂展示后自动关闭
    LaunchedEffect(state.stage) {
        if (state.stage == CallStage.ENDED) {
            kotlinx.coroutines.delay(800)
            viewModel.consumeEnded()
        }
    }

    // 2026-08-29新增：通话小窗(对齐iOS)。isMinimized时渲染悬浮气泡而非全屏通话界面，
    // 用户可退回App其它页面继续操作；上面的LaunchedEffect(state.stage)在CallHost顶层，
    // 不受这里的分支影响，结束态自动consumeEnded()在小窗状态下依然正常触发。
    if (state.isMinimized) {
        CallMinimizedBubble(viewModel = viewModel, state = state)
        return
    }

    // 权限：进入即申请（接听 / 呼叫均需要）
    val perms = remember(state.isVideo) {
        val base = if (state.isVideo) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
        else arrayOf(Manifest.permission.RECORD_AUDIO)
        // 蓝牙耳机音频路由需要 BLUETOOTH_CONNECT(Android 12+)；老系统上此权限不存在，系统会自动忽略。
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            base + Manifest.permission.BLUETOOTH_CONNECT
        } else base
    }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}
    LaunchedEffect(Unit) { permLauncher.launch(perms) }

    Box(Modifier.fillMaxSize().background(Color(0xFF1A1A1A))) {
        // 通话音量=0 提示:回铃音无声时用户会以为 App 坏了,主动引导调音量
        if (showVolumeHint) {
            Box(
                Modifier.align(Alignment.TopCenter).systemBarsPadding().padding(top = 48.dp)
                    .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.tag))
                    .background(Color(0xFF8A6D00))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(
                    "⚠️ 通话音量已静音,请按音量键调高",
                    color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm,
                )
            }
        }
        val showRemoteVideo = state.isVideo && state.remoteVideoActive &&
            (state.stage == CallStage.CONNECTED)

        if (showRemoteVideo) {
            VideoView(
                track = viewModel.remoteTrack(),
                eglContext = viewModel.eglBaseContext,
                mirror = false,
                modifier = Modifier.fillMaxSize(),
            )
            // 本地小窗
            if (state.cameraEnabled) {
                VideoView(
                    track = viewModel.localTrack(),
                    eglContext = viewModel.eglBaseContext,
                    mirror = true,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .systemBarsPadding()
                        .padding(16.dp)
                        .size(110.dp, 160.dp)
                        .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.thumb)),
                )
            }
        } else {
            // 音频 / 未接通：头像 + 状态（systemBarsPadding 避免文字被状态栏遮挡）
            Column(
                Modifier.fillMaxSize().systemBarsPadding().padding(top = 96.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                InitialAvatar(name = state.peerName.ifBlank { "?" }, size = 96.dp)
                Spacer(Modifier.height(16.dp))
                Text(state.peerName.ifBlank { "通话" }, color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.displaySm)
                Spacer(Modifier.height(8.dp))
                Text(
                    callStatusOrDuration(state.stage, state.isVideo, state.connectedAt, state.endedAt),
                    color = Color(0xFFBBBBBB), fontSize = com.touliao.app.ui.theme.VxinTextSize.base,
                )
                // 通话质量指示：getStats 2s 采样（RTT<200ms/丢包<2% 优; <500ms/<8% 中; 否则差）
                if (state.stage == CallStage.CONNECTED && state.callQuality.isNotEmpty()) {
                    val (qColor, qText) = when (state.callQuality) {
                        "poor" -> Color(0xFFFA5151) to "网络较差"
                        "medium" -> Color(0xFFF5A623) to "网络一般"
                        else -> com.touliao.app.ui.theme.VxinSuccess to "网络良好"
                    }
                    Text(
                        qText, color = qColor,
                        fontSize = com.touliao.app.ui.theme.VxinTextSize.sm,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }

        // 2026-08-29新增：通话小窗入口。仅呼出中/连接中/已接通显示——来电振铃态应先决定
        // 接听或拒绝，不给"划走忽略"的误解空间。
        if (state.stage == CallStage.OUTGOING || state.stage == CallStage.CONNECTING || state.stage == CallStage.CONNECTED) {
            Box(
                Modifier.align(Alignment.TopStart).systemBarsPadding().padding(start = 16.dp, top = 8.dp)
                    .size(36.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.15f))
                    .clickable { viewModel.setMinimized(true) },
                contentAlignment = Alignment.Center,
            ) { Text("⌄", color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.lg) }
        }

        // 控制按钮（systemBarsPadding 避免按钮被底部手势条遮挡）
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().systemBarsPadding().padding(bottom = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (state.stage == CallStage.INCOMING) {
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    RoundButton("接听", CallGreen) { viewModel.accept() }
                    RoundButton("回复消息", Color(0xFF555555)) { viewModel.rejectAndReply() }
                    RoundButton("拒绝", CallRed) { viewModel.reject() }
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    RoundButton(if (state.micEnabled) "麦克风开" else "麦克风关", Color(0xFF555555)) { viewModel.toggleMic() }
                    RoundButton(if (state.speakerOn) "扬声器开" else "扬声器关", Color(0xFF555555)) { viewModel.toggleSpeaker() }
                    if (state.bluetoothAvailable) {
                        RoundButton(if (state.bluetoothOn) "蓝牙开" else "蓝牙关", Color(0xFF555555)) { viewModel.toggleBluetooth() }
                    }
                    RoundButton(if (state.isVideo) "切语音" else "切视频", Color(0xFF555555)) { viewModel.toggleVideo() }
                    RoundButton("挂断", CallRed) { viewModel.hangup() }
                    if (state.isVideo) {
                        RoundButton(if (state.cameraEnabled) "摄像头开" else "摄像头关", Color(0xFF555555)) { viewModel.toggleCamera() }
                        RoundButton("翻转", Color(0xFF555555)) { viewModel.switchCamera() }
                    }
                }
            }
        }
    }
}

private fun statusText(stage: CallStage, video: Boolean): String = when (stage) {
    CallStage.OUTGOING -> "正在呼叫…"
    CallStage.INCOMING -> if (video) "邀请你视频通话" else "邀请你语音通话"
    CallStage.CONNECTING -> "连接中…"
    CallStage.CONNECTED -> "通话中"
    CallStage.ENDED -> "通话结束"
    CallStage.IDLE -> ""
}

/** 已接通显示每秒递增的通话时长(mm:ss)；结束态定格总时长；否则显示状态文案 */
@Composable
private fun callStatusOrDuration(stage: CallStage, video: Boolean, connectedAt: Long, endedAt: Long): String {
    // 接通过再结束：定格显示「通话时长 mm:ss」
    if (stage == CallStage.ENDED && connectedAt > 0L) {
        val end = if (endedAt > 0L) endedAt else android.os.SystemClock.elapsedRealtime()
        val secs = ((end - connectedAt) / 1000L).coerceAtLeast(0)
        return "通话时长 %02d:%02d".format(secs / 60, secs % 60)
    }
    if (stage != CallStage.CONNECTED || connectedAt <= 0L) return statusText(stage, video)
    var now by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(android.os.SystemClock.elapsedRealtime()) }
    androidx.compose.runtime.LaunchedEffect(connectedAt) {
        while (true) { now = android.os.SystemClock.elapsedRealtime(); kotlinx.coroutines.delay(1000) }
    }
    val secs = ((now - connectedAt) / 1000L).coerceAtLeast(0)
    return "%02d:%02d".format(secs / 60, secs % 60)
}

@Composable
private fun RoundButton(label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(64.dp).clip(CircleShape).background(color)
                .clickable { onClick() },
            contentAlignment = Alignment.Center,
        ) { Text(label.take(3), color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm) }
        Spacer(Modifier.height(4.dp))
        Text(label, color = Color(0xFFCCCCCC), fontSize = com.touliao.app.ui.theme.VxinTextSize.xs)
    }
}

/** SurfaceViewRenderer 包装：按 track 变化挂/摘 sink，离场释放 */
@Composable
private fun VideoView(
    track: VideoTrack?,
    eglContext: EglBase.Context,
    mirror: Boolean,
    modifier: Modifier = Modifier,
) {
    val rendererState = remember { mutableStateOf<SurfaceViewRenderer?>(null) }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                init(eglContext, null)
                setMirror(mirror)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setEnableHardwareScaler(true)
                rendererState.value = this
            }
        },
    )
    DisposableEffect(track, rendererState.value) {
        val r = rendererState.value
        if (r != null && track != null) runCatching { track.addSink(r) }
        onDispose { if (r != null && track != null) runCatching { track.removeSink(r) } }
    }
    DisposableEffect(Unit) {
        onDispose { rendererState.value?.let { runCatching { it.release() } } }
    }
}

/**
 * 通话小窗：可拖拽悬浮气泡，默认停靠右上角；拖动跟手，松手停在拖到的位置(不做边缘吸附，
 * 保持简单，对齐iOS CallMinimizedBubble)。视频通话已接通时显示对方画面缩略图，其余显示头像。
 * 单指轻点(累计位移<阈值)恢复全屏；用同一个pointerInput手动区分点击/拖拽，避免和
 * clickable抢手势(detectDragGestures会独占触摸序列，clickable的tap识别器永远等不到事件)。
 */
@Composable
private fun CallMinimizedBubble(viewModel: CallViewModel, state: com.touliao.app.core.call.CallState) {
    val bubbleSizeDp = 64.dp
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
        val density = androidx.compose.ui.platform.LocalDensity.current
        val bubblePx = with(density) { bubbleSizeDp.toPx() }
        val marginPx = bubblePx / 2 + with(density) { 8.dp.toPx() }
        val maxWidthPx = with(density) { maxWidth.toPx() }
        val maxHeightPx = with(density) { maxHeight.toPx() }
        val defaultXPx = maxWidthPx - marginPx
        val defaultYPx = with(density) { 130.dp.toPx() }

        var dragX by remember { mutableStateOf(0f) }
        var dragY by remember { mutableStateOf(0f) }
        var totalDrag by remember { mutableStateOf(0f) }

        val centerX = (defaultXPx + dragX).coerceIn(marginPx, (maxWidthPx - marginPx).coerceAtLeast(marginPx))
        val centerY = (defaultYPx + dragY).coerceIn(marginPx, (maxHeightPx - marginPx).coerceAtLeast(marginPx))

        Box(
            Modifier
                .offset {
                    androidx.compose.ui.unit.IntOffset(
                        (centerX - bubblePx / 2).roundToInt(),
                        (centerY - bubblePx / 2).roundToInt(),
                    )
                }
                .size(bubbleSizeDp)
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF262626))
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { totalDrag = 0f },
                        onDragEnd = { if (totalDrag < 8f) viewModel.setMinimized(false) },
                    ) { change, amount ->
                        change.consume()
                        dragX += amount.x
                        dragY += amount.y
                        totalDrag += kotlin.math.abs(amount.x) + kotlin.math.abs(amount.y)
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            if (state.isVideo && state.remoteVideoActive && state.stage == CallStage.CONNECTED) {
                VideoView(
                    track = viewModel.remoteTrack(), eglContext = viewModel.eglBaseContext,
                    mirror = false, modifier = Modifier.fillMaxSize(),
                )
            } else {
                InitialAvatar(name = state.peerName.ifBlank { "?" }, size = bubbleSizeDp)
            }
            if (state.stage != CallStage.CONNECTED) {
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)))
                androidx.compose.material3.CircularProgressIndicator(
                    modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp,
                )
            }
        }
    }
}
