package com.vxin.app.feature.call

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.core.call.CallStage
import com.vxin.app.ui.components.InitialAvatar
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

private val CallGreen = Color(0xFF07C160)
private val CallRed = Color(0xFFFA5151)

/** 全局通话浮层：通话激活时覆盖在主界面之上 */
@Composable
fun CallHost(viewModel: CallViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    if (state.stage == CallStage.IDLE) return

    // 结束态：短暂展示后自动关闭
    LaunchedEffect(state.stage) {
        if (state.stage == CallStage.ENDED) {
            kotlinx.coroutines.delay(800)
            viewModel.consumeEnded()
        }
    }

    // 权限：进入即申请（接听 / 呼叫均需要）
    val perms = remember(state.isVideo) {
        if (state.isVideo) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
        else arrayOf(Manifest.permission.RECORD_AUDIO)
    }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}
    LaunchedEffect(Unit) { permLauncher.launch(perms) }

    Box(Modifier.fillMaxSize().background(Color(0xFF1A1A1A))) {
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
                        .clip(RoundedCornerShape(8.dp)),
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
                Text(state.peerName.ifBlank { "通话" }, color = Color.White, fontSize = 22.sp)
                Spacer(Modifier.height(8.dp))
                Text(statusText(state.stage, state.isVideo), color = Color(0xFFBBBBBB), fontSize = 14.sp)
            }
        }

        // 控制按钮（systemBarsPadding 避免按钮被底部手势条遮挡）
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().systemBarsPadding().padding(bottom = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (state.stage == CallStage.INCOMING) {
                Row(horizontalArrangement = Arrangement.spacedBy(48.dp)) {
                    RoundButton("接听", CallGreen) { viewModel.accept() }
                    RoundButton("拒绝", CallRed) { viewModel.reject() }
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    RoundButton(if (state.micEnabled) "麦克风开" else "麦克风关", Color(0xFF555555)) { viewModel.toggleMic() }
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

@Composable
private fun RoundButton(label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(64.dp).clip(CircleShape).background(color)
                .clickable { onClick() },
            contentAlignment = Alignment.Center,
        ) { Text(label.take(3), color = Color.White, fontSize = 12.sp) }
        Spacer(Modifier.height(4.dp))
        Text(label, color = Color(0xFFCCCCCC), fontSize = 11.sp)
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
