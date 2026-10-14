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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.safeDrawingPadding
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.touliao.app.core.call.CallStage
import com.touliao.app.ui.theme.TouliaoMetrics
import com.touliao.app.ui.theme.TouliaoMedia
import com.touliao.app.ui.components.InitialAvatar
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

private val CallGreen = TouliaoMedia.accept // Opaque media controls keep a readable white foreground.
private val CallRed = TouliaoMedia.danger

/**
 * 1v1 通话全屏界面（CALL-2 起有两种模式，见 contracts C13）：
 * - [leaveCallUi] 为 null：内联模式，只有测试宿主 UiReviewActivity 使用。收起时写 isMinimized=true，
 *   并在同一个组合里画小窗；点小窗写回 false。
 * - [leaveCallUi] 不为 null：由 CallActivity 托管。永远画全屏(即使 isMinimized 为 true)；收起、返回键收起、
 *   "回复消息"都交给 leaveCallUi，由 CallActivity 先处理锁屏再执行 before 并离开。应用内小窗由 CallOverlay 负责。
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun CallHost(
    // 不再使用：拒接后回复改由 PendingConversationHolder.offer 交给 AppNavigation 跳转，
    // CallActivity 里也没有 NavController。保留参数只为兼容旧调用方的签名(contracts C13)。
    @Suppress("UNUSED_PARAMETER") navController: androidx.navigation.NavHostController? = null,
    viewModel: CallViewModel = hiltViewModel(),
    leaveCallUi: ((before: () -> Unit) -> Unit)? = null,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    if (state.stage == CallStage.IDLE) return

    // 托管模式：由 CallActivity 承载，不画小窗
    val hosted = leaveCallUi != null
    // 收起：托管模式先经 CallActivity 处理锁屏再写 isMinimized；内联模式直接写
    val minimize: () -> Unit = {
        if (leaveCallUi != null) leaveCallUi { viewModel.setMinimized(true) } else viewModel.setMinimized(true)
    }
    // 拒接后回复消息：托管模式同样先经 CallActivity 处理锁屏。
    // 对端信息在点按这一刻取快照：等待解锁期间对方挂断 / 来电超时会让状态归零，到时再读就拿不到对端了
    val reply: () -> Unit = {
        val peerId = state.peerId
        val peerName = state.peerName
        if (leaveCallUi != null) {
            leaveCallUi { viewModel.rejectAndReply(peerId, peerName) }
        } else {
            viewModel.rejectAndReply(peerId, peerName)
        }
    }

    // 2026-10-12：通话期间(来电振铃/呼出/接通，含小窗)保持屏幕常亮
    KeepScreenOnDuringCall()

    // 回铃音无声提示：通话音量=0 时 ToneGenerator 不发声，用户会以为 App 坏了。
    // 只在主叫等待期(calling)显示；音量恢复或接通后自动消失。
    val voiceVolumeZero by viewModel.voiceCallVolumeZero.collectAsStateWithLifecycle()
    val showVolumeHint = voiceVolumeZero &&
        (state.stage == CallStage.OUTGOING || state.stage == CallStage.CONNECTING)

    // 结束态：短暂展示后自动关闭
    LaunchedEffect(state.stage) {
        if (state.stage == CallStage.ENDED) {
            // 有失败原因（如对方忙线）时多停留一会儿，保证看得到
            kotlinx.coroutines.delay(if (state.endMessage.isNotEmpty()) 2000 else 800)
            viewModel.consumeEnded()
        }
    }

    // 2026-08-29新增：通话小窗(对齐iOS)。内联模式下 isMinimized 时渲染悬浮气泡而非全屏通话界面；
    // 上面的LaunchedEffect(state.stage)在CallHost顶层，不受这里的分支影响，结束态自动consumeEnded()照常触发。
    if (!hosted && state.isMinimized) {
        P2pCallBubble(
            state,
            eglContext = { viewModel.eglBaseContext },
            remoteTrack = { viewModel.remoteTrack() },
            onClick = { viewModel.setMinimized(false) },
        )
        return
    }

    com.touliao.app.ui.components.DarkMediaSystemBars()

    // 权限：进入即申请（接听 / 呼叫均需要）。麦克风/摄像头为必需，蓝牙(BLUETOOTH_CONNECT)为可选，见 CallPermissions
    val perms = remember(state.isVideo) {
        CallPermissions.toRequest(state.isVideo, android.os.Build.VERSION.SDK_INT)
    }
    val callScreenContext = androidx.compose.ui.platform.LocalContext.current
    val activity = callScreenContext as? android.app.Activity
    // 非空 = 弹"去设置"对话框，值为被永久拒绝的必需权限中文名
    var permDeniedDialogName by remember { mutableStateOf<String?>(null) }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        // 授权后补起通话前台服务（RECORD_AUDIO 未授权时 CallManager 建流阶段会跳过）+ 刷新蓝牙可用性
        viewModel.onPermissionsResult()
        // 此前结果被完全忽略——被拒绝后通话界面照常呈现，用户只会看到"听不到对方声音/
        // 对方看不到自己"却毫无线索。这不拦断通话流程（对方可能仍在等接听），只提示原因。
        // 只看必需权限：只拒绝"附近的设备"(蓝牙)时静默降级——不显示蓝牙按钮，不报缺少麦克风/摄像头。
        val denied = CallPermissions.deniedRequired(res)
        val message = CallPermissions.deniedMessage(denied)
        if (message != null) {
            // 永久拒绝（不再询问）→ 弹框引导去设置；普通拒绝 → Toast 提示（均只针对必需权限判断）
            val permanentlyDenied = activity?.let { act ->
                denied.any { perm ->
                    !androidx.core.app.ActivityCompat.shouldShowRequestPermissionRationale(act, perm)
                }
            } ?: false
            if (permanentlyDenied) {
                permDeniedDialogName = CallPermissions.displayName(denied)
            } else {
                com.touliao.app.ui.components.TouliaoFeedback.show(callScreenContext, message, com.touliao.app.ui.components.FeedbackKind.ERROR)
            }
        }
    }
    // 每通电话只申请一次(CALL-M1)：标记放在 CallManager（cleanup 时复位），CallActivity 重建、
    // 从小窗恢复全屏都不会重复弹系统权限框/"去设置"对话框；结束态不申请。
    // key 是"是否结束态"：上一通 ENDED 直接进入下一通 INCOMING 时全屏分支不离开组合，靠它重新触发。
    LaunchedEffect(state.stage == CallStage.ENDED) {
        if (state.stage != CallStage.ENDED && viewModel.tryConsumePermissionPrompt()) permLauncher.launch(perms)
    }
    permDeniedDialogName?.let { name ->
        com.touliao.app.ui.components.PermissionDeniedDialog(
            permissionName = name,
            onDismiss = { permDeniedDialogName = null },
        )
    }

    // 2026-10-12：全屏通话界面拦截返回键(此前穿透到下层页面)。
    // 呼出/连接中/已接通 → 收起(同左上角按钮)；来电振铃/结束态 → 吞掉，须明确接听/拒绝。
    // 绝不在返回键上挂断。内联模式的小窗态在上面已 return，不注册本回调，返回键交还给宿主。
    BackHandler {
        if (state.stage == CallStage.OUTGOING || state.stage == CallStage.CONNECTING || state.stage == CallStage.CONNECTED) {
            minimize()
        }
    }

    // 2026-10-12：全屏通话界面的根 Box 吃掉子控件未处理的触摸(内联模式下宿主页面在下层，防止点击穿透)；
    // 空 detectTapGestures 让根节点成为命中目标，子按钮仍优先处理(无涟漪/无无障碍语义)。
    Box(Modifier.fillMaxSize().background(TouliaoMedia.canvas).pointerInput(Unit) { detectTapGestures { } }) {
        // 通话音量=0 提示:回铃音无声时用户会以为 App 坏了,主动引导调音量
        if (showVolumeHint) {
            Box(
                Modifier.align(Alignment.TopCenter).safeDrawingPadding().padding(top = 48.dp)
                    .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.tag))
                    .background(Color(0xFF8A6D00))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(
                    "通话音量已静音,请按音量键调高",
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
                        .safeDrawingPadding()
                        .padding(16.dp)
                        .size(110.dp, 160.dp)
                        .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.thumb)),
                )
            }
        } else {
            // 音频 / 未接通：头像 + 状态（systemBarsPadding 避免文字被状态栏遮挡）
            Column(
                Modifier.fillMaxSize().safeDrawingPadding().padding(top = 96.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                InitialAvatar(name = state.peerName.ifBlank { "?" }, size = TouliaoMetrics.avatarCall)
                Spacer(Modifier.height(16.dp))
                Text(state.peerName.ifBlank { "通话" }, color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.displaySm)
                Spacer(Modifier.height(8.dp))
                Text(
                    state.endMessage.ifEmpty { callStatusOrDuration(state.stage, state.isVideo, state.connectedAt, state.endedAt) },
                    color = TouliaoMedia.secondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.base,
                )
                // 通话质量指示：getStats 2s 采样（RTT<200ms/丢包<2% 优; <500ms/<8% 中; 否则差）
                if (state.stage == CallStage.CONNECTED && state.callQuality.isNotEmpty()) {
                    val (qColor, qText) = when (state.callQuality) {
                        "poor" -> com.touliao.app.ui.theme.VxinError to "网络较差"
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
                Modifier.align(Alignment.TopStart).safeDrawingPadding().padding(start = 16.dp, top = 8.dp)
                    .size(com.touliao.app.ui.theme.TouliaoMetrics.touchTarget).clip(CircleShape).background(Color.White.copy(alpha = 0.15f))
                    .clickable(role = Role.Button) { minimize() },
                contentAlignment = Alignment.Center,
            ) { com.touliao.app.ui.TouliaoGlyph(com.touliao.app.ui.TouliaoIcons.Minimize, color = com.touliao.app.ui.IconColor.OnDark, size = com.touliao.app.ui.IconSize.Md, label = "收起通话") }
        }

        // 控制按钮（systemBarsPadding 避免按钮被底部手势条遮挡）
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(bottom = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (state.stage == CallStage.INCOMING) {
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    // 2026-10-12：拒绝在左、接听在右(对齐微信/Android 系统来电习惯)
                    RoundButton("拒绝", CallRed) { viewModel.reject() }
                    RoundButton("回复消息", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { reply() }
                    RoundButton("接听", CallGreen) { viewModel.accept() }
                }
            } else {
                androidx.compose.foundation.layout.FlowRow(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(16.dp), maxItemsInEachRow = 3,
                ) {
                    RoundButton(if (state.micEnabled) "麦克风开" else "麦克风关", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.toggleMic() }
                    RoundButton(if (state.speakerOn) "扬声器开" else "扬声器关", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.toggleSpeaker() }
                    if (state.bluetoothAvailable) {
                        RoundButton(if (state.bluetoothOn) "蓝牙开" else "蓝牙关", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.toggleBluetooth() }
                    }
                    RoundButton(if (state.isVideo) "切语音" else "切视频", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.toggleVideo() }
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
    com.touliao.app.ui.components.CallActionButton(label, color, onClick)
}

/**
 * 常亮引用计数，按 View 分开记：CallActivity 与 MainActivity 各有自己的根 View，
 * 同一个 View 上 1v1 与群通话(或小窗)各算一次，一方结束不会清掉另一方的常亮；
 * 也不会因为另一个 Activity 里还有通话界面，让这个 Activity 一直常亮。
 * 弱引用持有 View，Activity 销毁后自动回收。只在主线程访问。
 */
private val keepScreenOnRefs = java.util.WeakHashMap<android.view.View, Int>()

/** 通话界面/小窗在组合中即保持屏幕常亮；离开组合(通话归零)自动恢复 */
@Composable
internal fun KeepScreenOnDuringCall() {
    val view = androidx.compose.ui.platform.LocalView.current
    DisposableEffect(view) {
        keepScreenOnRefs[view] = (keepScreenOnRefs[view] ?: 0) + 1
        view.keepScreenOn = true
        onDispose {
            val left = (keepScreenOnRefs[view] ?: 0) - 1
            if (left <= 0) {
                keepScreenOnRefs.remove(view)
                view.keepScreenOn = false
            } else {
                keepScreenOnRefs[view] = left
            }
        }
    }
}

/** SurfaceViewRenderer 包装：按 track 变化挂/摘 sink，离场释放（CallBubble.kt 的小窗也用它） */
@Composable
internal fun VideoView(
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
