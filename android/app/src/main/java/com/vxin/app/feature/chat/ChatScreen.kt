package com.vxin.app.feature.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.vxin.app.data.model.Message
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    onBack: () -> Unit,
    onOpenGroupInfo: (String) -> Unit = {},
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val context = LocalContext.current

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.uploadFromUri(it, previewLocal = true) }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.uploadFromUri(it, previewLocal = false) }
    }
    val recordPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.startRecording()
    }

    val totalCount = state.messages.size + state.pending.size
    LaunchedEffect(totalCount) {
        if (totalCount > 0) listState.animateScrollToItem(totalCount - 1)
    }

    // 退出聊天：发送已读 + stop_typing
    DisposableEffect(Unit) {
        onDispose { viewModel.onLeave() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(state.title.ifBlank { "聊天" })
                        if (state.peerTyping) {
                            Text("对方正在输入…", fontSize = 11.sp, color = VxinGreen)
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    if (viewModel.isGroup) {
                        IconButton(onClick = { onOpenGroupInfo(viewModel.conversationId) }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "群聊信息")
                        }
                    }
                },
            )
        },
        bottomBar = {
            MessageInputBar(
                value = state.input,
                sending = state.sending,
                recording = state.recording,
                onValueChange = viewModel::onInputChange,
                onSend = viewModel::send,
                onPickImage = { imagePicker.launch("image/*") },
                onPickFile = { filePicker.launch("*/*") },
                onMicClick = {
                    if (state.recording) {
                        viewModel.stopRecordingAndSend()
                    } else {
                        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                            PackageManager.PERMISSION_GRANTED
                        if (granted) viewModel.startRecording() else recordPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                },
            )
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (state.loading && state.messages.isEmpty()) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.messages, key = { it.id }) { msg ->
                        val isMine = msg.sender_id == viewModel.myId
                        MessageBubble(
                            msg = msg,
                            isMine = isMine,
                            isRead = isMine && viewModel.isReadByPeer(msg),
                            resolveUrl = viewModel::resolveMediaUrl,
                            onPlayVoice = { viewModel.playVoice(msg.file_url) },
                            onOpenFile = { openUrl(context, viewModel.resolveMediaUrl(msg.file_url)) },
                        )
                    }
                    items(state.pending, key = { it.tempId }) { p ->
                        PendingBubble(p, onDismiss = { viewModel.dismissFailedPending(p.tempId) })
                    }
                }
            }
            state.error?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.align(Alignment.TopCenter).padding(8.dp),
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(
    msg: Message,
    isMine: Boolean,
    isRead: Boolean,
    resolveUrl: (String?) -> String?,
    onPlayVoice: () -> Unit,
    onOpenFile: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        if (!isMine) {
            InitialAvatar(name = msg.senderName.ifBlank { "?" }, size = 36.dp)
            Spacer(Modifier.size(6.dp))
        }
        Column(horizontalAlignment = if (isMine) Alignment.End else Alignment.Start) {
            if (!isMine && msg.senderName.isNotBlank()) {
                Text(msg.senderName, color = VxinTextSecondary, style = MaterialTheme.typography.labelSmall)
            }
            if (isMine) {
                // 已读双勾（绿）/ 已发单勾（灰）
                Text(
                    text = if (isRead) "✓✓ 已读" else "✓",
                    fontSize = 10.sp,
                    color = if (isRead) VxinGreen else VxinTextSecondary,
                )
            }
            when (msg.type) {
                "image" -> AsyncImage(
                    model = resolveUrl(msg.file_url),
                    contentDescription = "图片",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .widthIn(max = 220.dp)
                        .heightIn(max = 280.dp)
                        .clip(RoundedCornerShape(10.dp)),
                )
                "voice" -> MediaCard(isMine, onClick = onPlayVoice) { Text(if (isMine) "🎙 语音  ▶" else "▶  🎙 语音", color = bubbleTextColor(isMine)) }
                "file" -> MediaCard(isMine, onClick = onOpenFile) {
                    Text("📄 ${msg.content.ifBlank { "文件" }}", color = bubbleTextColor(isMine), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                "video" -> MediaCard(isMine, onClick = onOpenFile) { Text("🎬 视频", color = bubbleTextColor(isMine)) }
                else -> TextBubble(msg.content, isMine)
            }
        }
        if (isMine) Spacer(Modifier.size(6.dp))
    }
}

@Composable
private fun PendingBubble(p: PendingUpload, onDismiss: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Column(horizontalAlignment = Alignment.End) {
            Box(
                modifier = Modifier
                    .widthIn(max = 220.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (p.failed) Color(0x33FA5151) else VxinGreen.copy(alpha = 0.6f))
                    .clickable(enabled = p.failed) { onDismiss() }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                if (p.type == "image" && p.localUri != null && !p.failed) {
                    Box(contentAlignment = Alignment.Center) {
                        AsyncImage(
                            model = p.localUri,
                            contentDescription = "上传中",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.widthIn(max = 200.dp).heightIn(max = 240.dp).clip(RoundedCornerShape(8.dp)),
                        )
                        CircularProgressIndicator(Modifier.size(24.dp), color = Color.White, strokeWidth = 2.dp)
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (!p.failed) {
                            CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                            Spacer(Modifier.size(8.dp))
                        }
                        Text(
                            if (p.failed) "上传失败（点击移除）" else placeholderLabel(p),
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TextBubble(content: String, isMine: Boolean) {
    Box(
        modifier = Modifier
            .widthIn(max = 280.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (isMine) VxinGreen else Color.White)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(content, color = bubbleTextColor(isMine))
    }
}

@Composable
private fun MediaCard(isMine: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .widthIn(max = 240.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (isMine) VxinGreen else Color.White)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) { content() }
}

@Composable
private fun bubbleTextColor(isMine: Boolean): Color =
    if (isMine) Color.White else MaterialTheme.colorScheme.onSurface

private fun placeholderLabel(p: PendingUpload): String = when (p.type) {
    "image" -> "图片上传中…"
    "voice" -> "语音上传中…"
    "video" -> "视频上传中…"
    else -> "${p.name} 上传中…"
}

@Composable
private fun MessageInputBar(
    value: String,
    sending: Boolean,
    recording: Boolean,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onPickImage: () -> Unit,
    onPickFile: () -> Unit,
    onMicClick: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().imePadding()) {
        if (recording) {
            Text(
                "● 录音中…点击麦克风停止并发送",
                color = Color(0xFFFA5151),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onPickImage) { Text("🖼", style = MaterialTheme.typography.titleMedium) }
            IconButton(onClick = onPickFile) { Text("📎", style = MaterialTheme.typography.titleMedium) }
            IconButton(onClick = onMicClick) { Text(if (recording) "⏹" else "🎤", style = MaterialTheme.typography.titleMedium) }
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("输入消息…") },
                maxLines = 4,
            )
            Spacer(Modifier.size(4.dp))
            IconButton(onClick = onSend, enabled = value.isNotBlank() && !sending) {
                if (sending) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = "发送",
                        tint = if (value.isNotBlank()) VxinGreen else VxinTextSecondary,
                    )
                }
            }
        }
    }
}

private fun openUrl(context: android.content.Context, url: String?) {
    if (url.isNullOrBlank()) return
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
