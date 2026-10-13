package com.touliao.app.feature.call

import androidx.compose.material3.MaterialTheme
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.roundToInt
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

/** 全局通话浮层：通话激活时覆盖在主界面之上 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
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

    // 2026-10-12：通话期间(来电振铃/呼出/接通，含小窗)保持屏幕常亮
    KeepScreenOnDuringCall()

    // 回铃音无声提示：通话音量=0 时 ToneGenerator 不发声，用户会以为 App 坏了。
    // 只在主叫等待期(calling)显示；音量恢复或接通后自动消失。
    val voiceVolumeZero by viewModel.voiceCallVolumeZero.collectAsStateWithLifecycle()
    val showVolumeHint = voiceVolumeZero &&
        (state.stage == CallStage.OUTGOING || state.stage == CallStage.CONNECTING)

    // 每通电话只申请一次权限(CALL-M1)：标记放在小窗分支之前，从小窗恢复全屏时不再重复弹系统权限框/
    // "去设置"对话框。IDLE 时上面提前 return 会丢弃该标记；ENDED 时在下面复位，紧接着的下一通重新申请。
    var permRequestedThisCall by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }

    // 结束态：短暂展示后自动关闭
    LaunchedEffect(state.stage) {
        if (state.stage == CallStage.ENDED) {
            permRequestedThisCall = false
            // 有失败原因（如对方忙线）时多停留一会儿，保证看得到
            kotlinx.coroutines.delay(if (state.endMessage.isNotEmpty()) 2000 else 800)
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
    // 每通电话只申请一次（见 permRequestedThisCall）；结束态不申请。
    // key 含"是否结束态"：上一通 ENDED 直接进入下一通 INCOMING 时全屏分支不离开组合，靠它重新触发。
    LaunchedEffect(permRequestedThisCall, state.stage == CallStage.ENDED) {
        if (!permRequestedThisCall && state.stage != CallStage.ENDED) {
            permRequestedThisCall = true
            permLauncher.launch(perms)
        }
    }
    permDeniedDialogName?.let { name ->
        com.touliao.app.ui.components.PermissionDeniedDialog(
            permissionName = name,
            onDismiss = { permDeniedDialogName = null },
        )
    }

    // 2026-10-12：全屏通话界面拦截返回键(此前穿透到下层 NavHost 弹栈)。
    // 呼出/连接中/已接通 → 收起为小窗(同左上角按钮)；来电振铃/结束态 → 吞掉，须明确接听/拒绝。
    // 绝不在返回键上挂断。小窗态在上面已 return，不注册本回调，返回键交还给 App。
    BackHandler {
        if (state.stage == CallStage.OUTGOING || state.stage == CallStage.CONNECTING || state.stage == CallStage.CONNECTED) {
            minimizeCall(activity, viewModel)
        }
    }

    // 2026-10-12：CallHost 与 NavHost 是兄弟节点，根 Box 不处理触摸时点击会穿透到下层页面；
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
                    .clickable(role = Role.Button) { minimizeCall(activity, viewModel) },
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
                    RoundButton("回复消息", com.touliao.app.ui.theme.TouliaoDarkPalette.surfaceSecondary) { viewModel.rejectAndReply() }
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
 * 收起为小窗(CALL-2)。来电越过锁屏接听后设备仍处于锁屏时，先请求解锁、解锁成功才收起：
 * 收起后露出的是会话列表/聊天页，不能展示在锁屏上；用户取消解锁则留在通话页。
 * 收起本身是安全的——MainActivity 在通话收起时会撤掉"越过锁屏显示"，所以请求解锁失败
 * (onDismissError) 或 API 26 以下没有 requestDismissKeyguard 时直接收起，系统锁屏随即盖回。
 */
private fun minimizeCall(activity: android.app.Activity?, viewModel: CallViewModel) {
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
        val keyguard = activity?.getSystemService(android.content.Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
        if (activity != null && keyguard != null && keyguard.isKeyguardLocked) {
            keyguard.requestDismissKeyguard(activity, object : android.app.KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() { viewModel.setMinimized(true) }
                override fun onDismissError() { viewModel.setMinimized(true) }
                // onDismissCancelled：用户取消解锁，留在通话页
            })
            return
        }
    }
    viewModel.setMinimized(true)
}

/** 1v1 与群通话浮层挂在同一个 ComposeView 上，按引用计数开关 keepScreenOn，避免一方结束时清掉另一方的常亮(仅主线程访问) */
private var keepScreenOnRefs = 0

/** 通话浮层在组合中即保持屏幕常亮；离开组合(通话归零)自动恢复 */
@Composable
internal fun KeepScreenOnDuringCall() {
    val view = androidx.compose.ui.platform.LocalView.current
    DisposableEffect(view) {
        keepScreenOnRefs++
        view.keepScreenOn = true
        onDispose {
            keepScreenOnRefs = (keepScreenOnRefs - 1).coerceAtLeast(0)
            if (keepScreenOnRefs == 0) view.keepScreenOn = false
        }
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
 * CALL-1：点击与拖动拆成两个手势。此前只靠 detectDragGestures 的 onDragEnd 判断"位移<阈值"算点击，
 * 但拖动回调要手指先越过 touch slop 才触发，单纯点一下毫无反应，收起后回不到挂断键。
 * 现在外层 pointerInput 只管拖，内层 clickable 管点：拖动越过 slop 会消费事件，clickable 随之取消；
 * 单纯点按则正常触发 clickable，恢复全屏。clickable 同时提供读屏的按钮角色与操作说明。
 */
@Composable
private fun CallMinimizedBubble(viewModel: CallViewModel, state: com.touliao.app.core.call.CallState) {
    val bubbleSizeDp = 64.dp
    val peer = state.peerName.ifBlank { "对方" }
    val bubbleDescription = when (state.stage) {
        CallStage.CONNECTED -> "与${peer}通话中，点按返回"
        CallStage.ENDED -> "与${peer}的通话已结束"
        else -> "正在连接${peer}，点按返回"
    }
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
                .clickable(role = Role.Button, onClickLabel = "返回通话界面") { viewModel.setMinimized(false) }
                // 读屏只念一句"与 X 通话中，点按返回"，不再逐个念头像首字/加载圈(clickable 在外层，其按钮语义保留)
                .clearAndSetSemantics { contentDescription = bubbleDescription },
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
