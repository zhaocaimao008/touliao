package com.touliao.app.feature.moments

import android.net.Uri
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import androidx.compose.ui.graphics.asImageBitmap
import com.touliao.app.ui.theme.VxinGreen
import com.touliao.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun MomentComposeScreen(
    onBack: () -> Unit,
    onPublished: () -> Unit,
    viewModel: MomentComposeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isNotEmpty()) viewModel.addImages(uris)
    }
    // F4a 视频模式：系统 picker 单选 video/*（与聊天发视频同款 GetContent 路径）
    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.setVideo(it) }
    }

    LaunchedEffect(state.done) { if (state.done) onPublished() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("发表") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
                actions = {
                    TextButton(onClick = viewModel::publish, enabled = !state.publishing) {
                        if (state.publishing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        else Text("发表", color = VxinGreen)
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            OutlinedTextField(
                value = state.content,
                onValueChange = viewModel::onContentChange,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("这一刻的想法…") },
                minLines = 3,
            )
            Spacer(Modifier.size(12.dp))
            // 媒体模式切换（F4a）：图片 9 张 / 视频 1 段，互斥
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = state.mediaMode == "images",
                    onClick = { viewModel.setMediaMode("images") },
                    label = { Text("图片") },
                )
                FilterChip(
                    selected = state.mediaMode == "video",
                    onClick = { viewModel.setMediaMode("video") },
                    label = { Text("视频") },
                )
            }
            Spacer(Modifier.size(12.dp))
            if (state.mediaMode == "video") {
                // 视频模式：单段；已选则显示首帧封面 + 移除，未选显示添加格
                val video = state.video
                if (video == null) {
                    Box(
                        Modifier.fillMaxWidth(0.6f).aspectRatio(16f / 9f).clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.sm))
                            .clickable { videoPicker.launch("video/*") },
                        contentAlignment = Alignment.Center,
                    ) { Text("＋", color = VxinTextSecondary) }
                } else {
                    Box(
                        Modifier.fillMaxWidth(0.6f).aspectRatio(16f / 9f)
                            .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.sm)),
                    ) {
                        VideoThumb(uri = video, modifier = Modifier.fillMaxSize())
                        Box(
                            Modifier.fillMaxSize()
                                .background(Color(0x55000000))
                                .clickable { viewModel.removeVideo() },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("▶", color = Color.White, fontSize = com.touliao.app.ui.theme.VxinTextSize.xxl)
                        }
                        Text(
                            "✕",
                            color = Color.White,
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.thumb))
                                .clickable { viewModel.removeVideo() }
                                .padding(horizontal = 6.dp),
                        )
                    }
                }
                Spacer(Modifier.size(4.dp))
                Text(
                    if (state.video == null) "可选择 1 段视频" else "已选择视频",
                    color = VxinTextSecondary,
                    fontSize = com.touliao.app.ui.theme.VxinTextSize.sm,
                )
            } else {
            LazyVerticalGrid(columns = GridCells.Fixed(3), modifier = Modifier.fillMaxWidth()) {
                items(state.images, key = { it }) { uri ->
                    Box(Modifier.padding(2.dp).aspectRatio(1f)) {
                        AsyncImage(uri, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.sm)))
                        Text("✕", color = Color.White, modifier = Modifier.align(Alignment.TopEnd).clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.thumb)).clickable { viewModel.removeImage(uri) }.padding(horizontal = 6.dp))
                    }
                }
                if (state.images.size < 9) {
                    item {
                        Box(
                            Modifier.padding(2.dp).aspectRatio(1f).clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.sm))
                                .clickable { picker.launch("image/*") },
                            contentAlignment = Alignment.Center,
                        ) { Text("＋", color = VxinTextSecondary) }
                    }
                }
            }
            }
            Spacer(Modifier.size(16.dp))
            Text("谁可以看", color = VxinTextSecondary)
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    "all" to "公开", "friends" to "好友", "private" to "私密",
                    "include" to "部分可见", "exclude" to "不给谁看",
                ).forEach { (v, label) ->
                    FilterChip(selected = state.visibility == v, onClick = { viewModel.setVisibility(v) }, label = { Text(label) })
                }
            }
            if (state.visibility == "include" || state.visibility == "exclude") {
                Spacer(Modifier.size(8.dp))
                TextButton(onClick = viewModel::openFriendPicker) {
                    Text(
                        if (state.visibility == "include") "选择可见好友 (${state.visibleTo.size})" else "选择不给谁看 (${state.visibleTo.size})",
                        color = VxinGreen,
                    )
                }
            }
            state.error?.let {
                androidx.compose.runtime.LaunchedEffect(it) { kotlinx.coroutines.delay(2500); viewModel.consumeError() }
                Spacer(Modifier.size(12.dp))
                Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error)
            }
        }
    }

    if (state.showFriendPicker) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = viewModel::dismissFriendPicker,
            confirmButton = { TextButton(onClick = viewModel::dismissFriendPicker) { Text("确定 (${state.visibleTo.size})", color = VxinGreen) } },
            title = { Text(if (state.visibility == "include") "选择可见好友" else "选择不给谁看") },
            text = {
                if (state.friends.isEmpty()) {
                    Text("暂无好友", color = VxinTextSecondary)
                } else {
                    Column(Modifier.fillMaxWidth()) {
                        state.friends.forEach { f ->
                            val checked = state.visibleTo.contains(f.id)
                            Row(
                                Modifier.fillMaxWidth().clickable { viewModel.toggleVisibleFriend(f.id) }.padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(f.displayName.ifBlank { "用户" }, modifier = Modifier.weight(1f))
                                Text(if (checked) "✓" else "", color = VxinGreen)
                            }
                        }
                    }
                }
            },
        )
    }
}

/**
 * 本地视频首帧缩略图（F4a 朋友圈发视频预览用）：
 * MediaMetadataRetriever 取第 0 秒帧，IO 线程执行；取不到（损坏/格式不支持）给黑底占位。
 */
@Composable
private fun VideoThumb(uri: Uri, modifier: Modifier = Modifier) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var thumb by remember(uri) { androidx.compose.runtime.mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(uri) {
        thumb = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                val retriever = android.media.MediaMetadataRetriever()
                try {
                    retriever.setDataSource(context, uri)
                    retriever.getFrameAtTime(0, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                } finally {
                    retriever.release()
                }
            }.getOrNull()
        }
    }
    Box(modifier.background(Color(0xFF1A1A1A)), contentAlignment = Alignment.Center) {
        thumb?.let {
            androidx.compose.foundation.Image(
                bitmap = it.asImageBitmap(),
                contentDescription = "视频封面",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } ?: Text("🎬", fontSize = com.touliao.app.ui.theme.VxinTextSize.lg)
    }
}
