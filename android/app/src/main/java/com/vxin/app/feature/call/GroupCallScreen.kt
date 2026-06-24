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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.core.call.GroupCallStage
import com.vxin.app.core.realtime.GroupCallInviteEvent
import com.vxin.app.ui.components.InitialAvatar

private val CallGreen = Color(0xFF07C160)
private val CallRed = Color(0xFFFA5151)

/** 全局群通话浮层 + 来电邀请横幅：始终挂载，监听邀请与通话状态。 */
@Composable
fun GroupCallHost(viewModel: GroupCallViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val remoteTracks by viewModel.remoteTracks.collectAsStateWithLifecycle()
    var invite by remember { mutableStateOf<GroupCallInviteEvent?>(null) }

    LaunchedEffect(Unit) { viewModel.inviteEvents.collect { invite = it } }
    // 已进入通话则清掉邀请横幅；结束态稍后自动归零
    if (state.stage != GroupCallStage.IDLE && state.stage != GroupCallStage.ENDED) invite = null
    LaunchedEffect(state.stage) {
        if (state.stage == GroupCallStage.ENDED) { kotlinx.coroutines.delay(800); viewModel.consumeEnded() }
    }

    // 通话进行中：全屏浮层
    if (state.stage != GroupCallStage.IDLE) {
        val perms = remember(state.isVideo) {
            if (state.isVideo) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
            else arrayOf(Manifest.permission.RECORD_AUDIO)
        }
        val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}
        LaunchedEffect(Unit) { permLauncher.launch(perms) }

        Box(Modifier.fillMaxSize().background(Color(0xFF121212))) {
            Text(
                "群${if (state.isVideo) "视频" else "语音"}通话 · ${state.participants.size + 1} 人",
                color = Color.White, fontSize = 15.sp,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 16.dp),
            )

            val cols = if (state.participants.size + 1 <= 1) 1 else if (state.participants.size + 1 <= 4) 2 else 3
            LazyVerticalGrid(
                columns = GridCells.Fixed(cols),
                modifier = Modifier.align(Alignment.Center).fillMaxWidth().padding(8.dp),
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
                    Tile(
                        track = if (state.isVideo) remoteTracks[pid] else null,
                        eglContext = viewModel.eglBaseContext, mirror = false, label = "成员",
                    )
                }
            }

            Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 40.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
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
        return
    }

    // 收到邀请（且未在通话中）：顶部横幅
    invite?.let { inv ->
        Box(Modifier.fillMaxWidth().padding(top = 60.dp), contentAlignment = Alignment.TopCenter) {
            Row(
                Modifier.clip(RoundedCornerShape(14.dp)).background(Color(0xFF2C2C2E)).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("${inv.fromName.ifBlank { "群成员" }} 发起了群${if (inv.type == "video") "视频" else "语音"}通话",
                    color = Color.White, fontSize = 14.sp)
                Box(Modifier.clip(RoundedCornerShape(8.dp)).background(CallGreen)
                    .clickable { viewModel.join(inv.callId, inv.conversationId, inv.type == "video"); invite = null }
                    .padding(horizontal = 14.dp, vertical = 6.dp)) { Text("加入", color = Color.White, fontSize = 13.sp) }
                Box(Modifier.clickable { invite = null }.padding(horizontal = 8.dp, vertical = 6.dp)) {
                    Text("忽略", color = Color(0xFF999999), fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun Tile(track: org.webrtc.VideoTrack?, eglContext: org.webrtc.EglBase.Context, mirror: Boolean, label: String, self: Boolean = false) {
    Box(
        Modifier.fillMaxWidth().aspectRatio(0.85f).clip(RoundedCornerShape(10.dp)).background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        if (track != null) {
            VideoRenderer(track = track, eglContext = eglContext, mirror = mirror, modifier = Modifier.fillMaxSize())
        } else {
            InitialAvatar(name = label, size = 64.dp)
        }
        Text(label, color = Color.White, fontSize = 11.sp,
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
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(color).clickable { onClick() },
            contentAlignment = Alignment.Center) { Text(label.take(3), color = Color.White, fontSize = 12.sp) }
        Spacer(Modifier.height(4.dp))
        Text(label, color = Color(0xFFCCCCCC), fontSize = 11.sp)
    }
}
