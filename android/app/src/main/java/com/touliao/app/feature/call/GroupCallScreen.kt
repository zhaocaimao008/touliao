package com.touliao.app.feature.call

import androidx.compose.material3.MaterialTheme
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.touliao.app.core.call.GroupCallStage
import com.touliao.app.core.call.GroupRoster
import com.touliao.app.ui.theme.TouliaoMedia
import com.touliao.app.ui.components.InitialAvatar

private val CallRed = TouliaoMedia.danger

/**
 * 群通话全屏界面。邀请横幅已移到 MainActivity 的 CallOverlay（数据来自 GroupCallInviteCoordinator）。
 * [leaveCallUi] 的两种模式同 1v1 [CallHost]（contracts C13）：
 * - 为 null：内联模式（测试宿主），收起后在同一个组合里画小窗，点小窗恢复全屏；
 * - 不为 null：由 CallActivity 托管，永远画全屏，收起交给 leaveCallUi。
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun GroupCallHost(
    viewModel: GroupCallViewModel = hiltViewModel(),
    leaveCallUi: ((before: () -> Unit) -> Unit)? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val remoteTracks by viewModel.remoteTracks.collectAsStateWithLifecycle()
    val roster by viewModel.roster.collectAsStateWithLifecycle()

    // 收起：托管模式先经 CallActivity 处理锁屏再写 isMinimized；内联模式直接写
    val minimize: () -> Unit = {
        if (leaveCallUi != null) leaveCallUi { viewModel.setMinimized(true) } else viewModel.setMinimized(true)
    }

    // 结束态稍后自动归零
    LaunchedEffect(state.stage) {
        if (state.stage == GroupCallStage.ENDED) { kotlinx.coroutines.delay(800); viewModel.consumeEnded() }
    }

    // 通话进行中：全屏界面
    if (state.stage != GroupCallStage.IDLE) {
        // 2026-10-12：通话期间保持屏幕常亮(与 1v1 共用按 View 的引用计数)，小窗状态下同样常亮
        KeepScreenOnDuringCall()

        // 麦克风/摄像头为必需，蓝牙(BLUETOOTH_CONNECT，Android 12+)为可选，同 1v1 CallScreen（见 CallPermissions）
        val perms = remember(state.isVideo) {
            CallPermissions.toRequest(state.isVideo, android.os.Build.VERSION.SDK_INT)
        }
        val groupCallContext = androidx.compose.ui.platform.LocalContext.current
        val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
            // 授权后补起通话前台服务（RECORD_AUDIO 未授权时建流阶段会跳过）+ 刷新蓝牙可用性
            viewModel.onPermissionsResult()
            // 只看必需权限：只拒绝"附近的设备"(蓝牙)时不提示，只是不显示蓝牙按钮
            CallPermissions.deniedMessage(CallPermissions.deniedRequired(res))?.let { message ->
                com.touliao.app.ui.components.TouliaoFeedback.show(groupCallContext, message, com.touliao.app.ui.components.FeedbackKind.ERROR)
            }
        }
        // 每通电话只申请一次（标记在 GroupCallManager，CallActivity 重建、从小窗恢复都不重复弹框）；结束态不申请
        LaunchedEffect(state.stage == GroupCallStage.ENDED) {
            if (state.stage != GroupCallStage.ENDED && viewModel.tryConsumePermissionPrompt()) permLauncher.launch(perms)
        }

        // CALL-11：内联模式下收起后画小窗（托管模式的小窗由 MainActivity 的 CallOverlay 负责）
        if (leaveCallUi == null && state.isMinimized &&
            (state.stage == GroupCallStage.CONNECTING || state.stage == GroupCallStage.CONNECTED)
        ) {
            GroupCallBubble(state, roster, remoteTracks, { viewModel.eglBaseContext }) { viewModel.setMinimized(false) }
            return
        }

        com.touliao.app.ui.components.DarkMediaSystemBars()

        // CALL-11：返回键在连接中/通话中收起(同左上角按钮)，结束态吞掉；任何情况都不挂断。
        // 内联模式的小窗态在上面已 return，不注册本回调，返回键交还给宿主。
        BackHandler {
            if (state.stage == GroupCallStage.CONNECTING || state.stage == GroupCallStage.CONNECTED) minimize()
        }

        // 2026-10-12：根节点吃掉子控件未处理的触摸，防止点击穿透到下层页面(同 1v1 CallHost)
        Column(Modifier.fillMaxSize().background(com.touliao.app.ui.theme.TouliaoDarkPalette.background).pointerInput(Unit) { detectTapGestures { } }.systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.fillMaxWidth()) {
                // 左上角收起按钮(同 1v1)：只在连接中/通话中显示，结束态没有可收起的通话
                if (state.stage == GroupCallStage.CONNECTING || state.stage == GroupCallStage.CONNECTED) {
                    Box(
                        Modifier.align(Alignment.CenterStart).padding(start = 16.dp)
                            .size(com.touliao.app.ui.theme.TouliaoMetrics.touchTarget).clip(CircleShape).background(Color.White.copy(alpha = 0.15f))
                            .clickable(role = Role.Button) { minimize() },
                        contentAlignment = Alignment.Center,
                    ) { com.touliao.app.ui.TouliaoGlyph(com.touliao.app.ui.TouliaoIcons.Minimize, color = com.touliao.app.ui.IconColor.OnDark, size = com.touliao.app.ui.IconSize.Md, label = "收起通话") }
                }
                val durationText = groupCallDuration(state.connectedAt)
                // 左右各让出收起按钮的宽度，标题始终居中且不压到按钮
                Text(
                    "群${if (state.isVideo) "视频" else "语音"}通话 · ${state.participants.size + 1} 人" +
                        if (durationText.isNotEmpty()) "  $durationText" else "",
                    color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.md,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 72.dp, vertical = 16.dp),
                )
            }

            val cols = if (state.participants.size + 1 <= 1) 1 else if (state.participants.size + 1 <= 4) 2 else 3
            LazyVerticalGrid(
                columns = GridCells.Fixed(cols),
                modifier = Modifier.weight(1f).fillMaxWidth().padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                item {
                    Tile(
                        track = if (state.isVideo && state.cameraEnabled) viewModel.localTrack() else null,
                        eglContext = viewModel.eglBaseContext, mirror = true, label = "我", self = true,
                    )
                }
                items(state.participants, key = { it }) { pid ->
                    // CALL-11：宫格显示群昵称；名单不属于本次通话所在的群时一律"群成员"
                    val name = groupTileName(roster, state.conversationId, pid)
                    Tile(
                        track = if (state.isVideo) remoteTracks[pid] else null,
                        eglContext = viewModel.eglBaseContext, mirror = false, label = name,
                    )
                }
            }

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth(), maxItemsInEachRow = 3, horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    RoundButton(if (state.micEnabled) "麦克风开" else "麦克风关", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.toggleMic() }
                    RoundButton(if (state.speakerOn) "扬声器开" else "扬声器关", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.toggleSpeaker() }
                    if (state.bluetoothAvailable) {
                        RoundButton(if (state.bluetoothOn) "蓝牙开" else "蓝牙关", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.toggleBluetooth() }
                    }
                    RoundButton("挂断", CallRed) { viewModel.hangup() }
                    if (state.isVideo) {
                        RoundButton(if (state.cameraEnabled) "摄像头开" else "摄像头关", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.toggleCamera() }
                        RoundButton("翻转", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.switchCamera() }
                    }
                }
            }
        }
    }
}

/** 宫格成员名（纯函数，JVM 单测覆盖）：名单属于本次群通话所在的群才查昵称，否则一律"群成员"（contracts C6） */
internal fun groupTileName(roster: GroupRoster, conversationId: String, userId: String): String =
    if (roster.conversationId == conversationId) roster.nameOf(userId) else "群成员"

@Composable
private fun Tile(track: org.webrtc.VideoTrack?, eglContext: org.webrtc.EglBase.Context, mirror: Boolean, label: String, self: Boolean = false) {
    Box(
        Modifier.fillMaxWidth().aspectRatio(0.85f).clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.badge)).background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        if (track != null) {
            VideoRenderer(track = track, eglContext = eglContext, mirror = mirror, modifier = Modifier.fillMaxSize())
        } else {
            InitialAvatar(name = label, size = 64.dp)
        }
        Text(label, color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.xs,
            modifier = Modifier.align(Alignment.BottomStart).padding(6.dp))
    }
}

/** SurfaceViewRenderer 包装：按 track 变化挂/摘 sink，离场释放 */
@Composable
private fun VideoRenderer(
    track: org.webrtc.VideoTrack,
    eglContext: org.webrtc.EglBase.Context,
    mirror: Boolean,
    modifier: Modifier = Modifier,
) {
    val rendererState = remember { mutableStateOf<org.webrtc.SurfaceViewRenderer?>(null) }
    androidx.compose.ui.viewinterop.AndroidView(
        modifier = modifier,
        factory = { ctx ->
            org.webrtc.SurfaceViewRenderer(ctx).apply {
                init(eglContext, null)
                setMirror(mirror)
                setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setEnableHardwareScaler(true)
                rendererState.value = this
            }
        },
    )
    androidx.compose.runtime.DisposableEffect(track, rendererState.value) {
        val r = rendererState.value
        if (r != null) runCatching { track.addSink(r) }
        onDispose { if (r != null) runCatching { track.removeSink(r) } }
    }
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose { rendererState.value?.let { runCatching { it.release() } } }
    }
}

@Composable
private fun RoundButton(label: String, color: Color, onClick: () -> Unit) {
    com.touliao.app.ui.components.CallActionButton(label, color, onClick)
}

/** 群通话接通后每秒递增的时长(mm:ss)，未接通返回空串 */
@androidx.compose.runtime.Composable
private fun groupCallDuration(connectedAt: Long): String {
    if (connectedAt <= 0L) return ""
    var now by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(android.os.SystemClock.elapsedRealtime()) }
    androidx.compose.runtime.LaunchedEffect(connectedAt) {
        while (true) { now = android.os.SystemClock.elapsedRealtime(); kotlinx.coroutines.delay(1000) }
    }
    val secs = ((now - connectedAt) / 1000L).coerceAtLeast(0)
    return "%02d:%02d".format(secs / 60, secs % 60)
}
