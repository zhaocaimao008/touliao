package com.vxin.app.feature.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.input.KeyboardType
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
    var showRedPacketSend by remember { mutableStateOf(false) }
    var showPinnedList by remember { mutableStateOf(false) }

    // 通话发起：先申请权限再拨打
    var pendingCallVideo by remember { mutableStateOf<Boolean?>(null) }
    val callPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        val v = pendingCallVideo
        pendingCallVideo = null
        if (v != null && res.values.all { it }) viewModel.startCall(v)
    }
    fun launchCall(video: Boolean) {
        pendingCallVideo = video
        callPermLauncher.launch(
            if (video) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
            else arrayOf(Manifest.permission.RECORD_AUDIO)
        )
    }

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
                    } else {
                        IconButton(onClick = { launchCall(false) }) { Text("📞", style = MaterialTheme.typography.titleMedium) }
                        IconButton(onClick = { launchCall(true) }) { Text("📹", style = MaterialTheme.typography.titleMedium) }
                    }
                },
            )
        },
        bottomBar = {
            var showPanel by remember { mutableStateOf(false) }
            LaunchedEffect(showPanel) { if (showPanel) viewModel.loadStickers() }
            Column {
                state.replyingTo?.let { r ->
                    Row(
                        Modifier.fillMaxWidth().background(Color(0x11000000)).padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "回复 ${r.senderName.ifBlank { "" }}: ${replyPreviewOf(r)}",
                            Modifier.weight(1f), color = VxinTextSecondary, fontSize = 12.sp,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Text("✕", Modifier.clickable { viewModel.cancelReply() }.padding(start = 8.dp), color = VxinTextSecondary)
                    }
                }
                MessageInputBar(
                    value = state.input,
                    sending = state.sending,
                    recording = state.recording,
                    onValueChange = viewModel::onInputChange,
                    onSend = viewModel::send,
                    onPickImage = { imagePicker.launch("image/*") },
                    onPickFile = { filePicker.launch("*/*") },
                    onTogglePanel = { showPanel = !showPanel },
                    onRedPacket = { showRedPacketSend = true },
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
                if (showPanel) {
                    StickerEmojiPanel(
                        stickers = state.stickers,
                        resolveUrl = viewModel::resolveMediaUrl,
                        onEmoji = viewModel::appendEmoji,
                        onSticker = { viewModel.sendSticker(it); showPanel = false },
                    )
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
          Column(Modifier.fillMaxSize()) {
            if (state.pinnedMessages.isNotEmpty()) {
                PinnedBanner(state.pinnedMessages) { showPinnedList = true }
            }
          Box(Modifier.weight(1f).fillMaxWidth()) {
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
                            onReply = { viewModel.startReply(msg) },
                            onRecall = { viewModel.recall(msg) },
                            onReact = { emoji -> viewModel.react(msg, emoji) },
                            onCollectSticker = { viewModel.collectSticker(msg.file_url) },
                            redPacket = viewModel.parseRedPacket(msg),
                            onOpenRedPacket = { viewModel.openRedPacket(msg) },
                            canPin = viewModel.isGroup,
                            isPinned = viewModel.isPinned(msg.id),
                            onTogglePin = { if (viewModel.isPinned(msg.id)) viewModel.unpinMessage(msg.id) else viewModel.pinMessage(msg) },
                        )
                    }
                    items(state.pending, key = { it.tempId }) { p ->
                        PendingBubble(p, onDismiss = { viewModel.dismissFailedPending(p.tempId) })
                    }
                }
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

    if (showRedPacketSend) {
        SendRedPacketDialog(
            onDismiss = { showRedPacketSend = false },
            onSend = { amount, count, greeting ->
                viewModel.sendRedPacket(amount, count, greeting)
                showRedPacketSend = false
            },
        )
    }

    state.redPacketDetail?.let { detail ->
        RedPacketDetailDialog(
            detail = detail,
            myId = viewModel.myId,
            claimedAmount = state.claimedAmount,
            onClaim = viewModel::claimOpenedRedPacket,
            onDismiss = viewModel::closeRedPacket,
        )
    }

    if (showPinnedList) {
        AlertDialog(
            onDismissRequest = { showPinnedList = false },
            title = { Text("置顶消息 (${state.pinnedMessages.size})") },
            text = {
                androidx.compose.foundation.lazy.LazyColumn {
                    items(state.pinnedMessages, key = { it.msgId }) { p ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(p.senderName.ifBlank { "成员" }, fontSize = 12.sp, color = VxinTextSecondary)
                                Text(pinnedPreview(p), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                            TextButton(onClick = { viewModel.unpinMessage(p.msgId) }) { Text("取消", color = Color(0xFFFA5151)) }
                        }
                        HorizontalDivider(thickness = 0.5.dp)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showPinnedList = false }) { Text("关闭") } },
        )
    }
}

private fun pinnedPreview(p: com.vxin.app.data.model.PinnedMessage): String = when (p.type) {
    "image" -> "[图片]"; "voice" -> "[语音]"; "video" -> "[视频]"; "file" -> "[文件]"; "red_packet" -> "[红包]"
    else -> p.content
}

@Composable
private fun PinnedBanner(pinned: List<com.vxin.app.data.model.PinnedMessage>, onClick: () -> Unit) {
    val latest = pinned.firstOrNull() ?: return
    Row(
        modifier = Modifier.fillMaxWidth().background(Color(0xFFFFF7E6)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("📌", fontSize = 14.sp)
        Spacer(Modifier.size(8.dp))
        Text(pinnedPreview(latest), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
        if (pinned.size > 1) Text("${pinned.size} 条", color = VxinTextSecondary, fontSize = 12.sp)
    }
}

private val REACTION_EMOJIS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun MessageBubble(
    msg: Message,
    isMine: Boolean,
    isRead: Boolean,
    resolveUrl: (String?) -> String?,
    onPlayVoice: () -> Unit,
    onOpenFile: () -> Unit,
    onReply: () -> Unit,
    onRecall: () -> Unit,
    onReact: (String) -> Unit,
    onCollectSticker: () -> Unit,
    redPacket: com.vxin.app.data.model.RedPacketContent? = null,
    onOpenRedPacket: () -> Unit = {},
    canPin: Boolean = false,
    isPinned: Boolean = false,
    onTogglePin: () -> Unit = {},
) {
    var menuOpen by remember { mutableStateOf(false) }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current

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
                Text(
                    text = if (isRead) "✓✓ 已读" else "✓",
                    fontSize = 10.sp,
                    color = if (isRead) VxinGreen else VxinTextSecondary,
                )
            }
            // 被回复消息引用条
            msg.replyTo?.let { rt ->
                Box(
                    Modifier.widthIn(max = 260.dp).clip(RoundedCornerShape(6.dp))
                        .background(Color(0x11000000)).padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        "${rt.senderName}: ${replyPreviewText(rt)}",
                        color = VxinTextSecondary, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.size(2.dp))
            }
            // 红包消息：点击打开领取弹窗，无长按菜单
            if (redPacket != null) {
                RedPacketCard(redPacket, isMine, onClick = onOpenRedPacket)
                return@Column
            }
            // 气泡本体(长按弹菜单)
            Box {
                Box(Modifier.combinedClickable(onClick = {}, onLongClick = { menuOpen = true })) {
                    MessageContent(msg, isMine, resolveUrl, onPlayVoice, onOpenFile)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    // 表情回应行
                    Row(Modifier.padding(horizontal = 8.dp)) {
                        REACTION_EMOJIS.forEach { e ->
                            Text(e, fontSize = 20.sp, modifier = Modifier
                                .padding(4.dp)
                                .clickable { onReact(e); menuOpen = false })
                        }
                    }
                    HorizontalDivider()
                    if (msg.type == "text") {
                        DropdownMenuItem(text = { Text("复制") }, onClick = {
                            clipboard.setText(androidx.compose.ui.text.AnnotatedString(msg.content)); menuOpen = false
                        })
                    }
                    DropdownMenuItem(text = { Text("回复") }, onClick = { onReply(); menuOpen = false })
                    if (canPin) {
                        DropdownMenuItem(text = { Text(if (isPinned) "取消置顶" else "置顶") }, onClick = { onTogglePin(); menuOpen = false })
                    }
                    if (msg.type == "image") {
                        DropdownMenuItem(text = { Text("收藏表情") }, onClick = { onCollectSticker(); menuOpen = false })
                    }
                    if (isMine) {
                        DropdownMenuItem(text = { Text("撤回", color = Color(0xFFFA5151)) }, onClick = { onRecall(); menuOpen = false })
                    }
                }
            }
            // 表情回应展示
            if (msg.reactions.isNotEmpty()) {
                Spacer(Modifier.size(2.dp))
                Row {
                    msg.reactions.forEach { r ->
                        Box(
                            Modifier.padding(end = 4.dp).clip(RoundedCornerShape(10.dp))
                                .background(Color(0x11000000)).padding(horizontal = 6.dp, vertical = 1.dp),
                        ) { Text("${r.emoji} ${r.count}", fontSize = 11.sp) }
                    }
                }
            }
        }
        if (isMine) Spacer(Modifier.size(6.dp))
    }
}

private fun replyPreviewText(rt: com.vxin.app.data.model.ReplyPreview): String = when (rt.type) {
    "image" -> "[图片]"; "voice" -> "[语音]"; "video" -> "[视频]"; "file" -> "[文件]"
    else -> rt.content
}

private fun replyPreviewOf(msg: Message): String = when (msg.type) {
    "image" -> "[图片]"; "voice" -> "[语音]"; "video" -> "[视频]"; "file" -> "[文件]"
    else -> msg.content
}

@Composable
private fun MessageContent(
    msg: Message,
    isMine: Boolean,
    resolveUrl: (String?) -> String?,
    onPlayVoice: () -> Unit,
    onOpenFile: () -> Unit,
) {
    Column(horizontalAlignment = if (isMine) Alignment.End else Alignment.Start) {
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
    onTogglePanel: () -> Unit,
    onRedPacket: () -> Unit,
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
            IconButton(onClick = onTogglePanel) { Text("😀", style = MaterialTheme.typography.titleMedium) }
            IconButton(onClick = onPickImage) { Text("🖼", style = MaterialTheme.typography.titleMedium) }
            IconButton(onClick = onPickFile) { Text("📎", style = MaterialTheme.typography.titleMedium) }
            IconButton(onClick = onRedPacket) { Text("🧧", style = MaterialTheme.typography.titleMedium) }
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

private val EMOJIS = listOf(
    "😀","😁","😂","🤣","😊","😍","😘","😎","🤔","😅","😉","😴","😭","😡","🥺","👍",
    "👎","🙏","👏","💪","🎉","❤️","💔","🔥","⭐","✅","❌","🌹","🍺","☕","🤝","👌",
)

@Composable
private fun StickerEmojiPanel(
    stickers: List<com.vxin.app.data.model.Sticker>,
    resolveUrl: (String?) -> String?,
    onEmoji: (String) -> Unit,
    onSticker: (com.vxin.app.data.model.Sticker) -> Unit,
) {
    var tab by remember { mutableStateOf(0) }
    Column(Modifier.fillMaxWidth().heightIn(max = 240.dp).background(Color(0xFFF2F2F2))) {
        Row(Modifier.padding(8.dp)) {
            TextButton(onClick = { tab = 0 }) { Text("表情", color = if (tab == 0) VxinGreen else VxinTextSecondary) }
            TextButton(onClick = { tab = 1 }) { Text("贴纸", color = if (tab == 1) VxinGreen else VxinTextSecondary) }
        }
        if (tab == 0) {
            LazyVerticalGrid(columns = GridCells.Fixed(8), modifier = Modifier.fillMaxWidth().heightIn(max = 190.dp)) {
                gridItems(EMOJIS) { e ->
                    Text(e, fontSize = 22.sp, modifier = Modifier.padding(6.dp).clickable { onEmoji(e) })
                }
            }
        } else {
            if (stickers.isEmpty()) {
                Box(Modifier.fillMaxWidth().heightIn(min = 80.dp), Alignment.Center) {
                    Text("还没有表情，长按聊天图片可「收藏表情」", color = VxinTextSecondary, fontSize = 12.sp)
                }
            } else {
                LazyVerticalGrid(columns = GridCells.Fixed(4), modifier = Modifier.fillMaxWidth().heightIn(max = 190.dp)) {
                    gridItems(stickers, key = { it.id }) { s ->
                        AsyncImage(
                            model = resolveUrl(s.url),
                            contentDescription = "表情",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.padding(6.dp).size(64.dp).clickable { onSticker(s) },
                        )
                    }
                }
            }
        }
    }
}

private val RedPacketRed = Color(0xFFE8503A)
private val RedPacketGold = Color(0xFFFCE2A8)

@Composable
private fun RedPacketCard(
    content: com.vxin.app.data.model.RedPacketContent,
    isMine: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .widthIn(max = 240.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(RedPacketRed)
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("🧧", fontSize = 28.sp)
        Spacer(Modifier.size(10.dp))
        Column {
            Text(
                content.greeting.ifBlank { "恭喜发财，大吉大利" },
                color = Color.White, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text("领取红包", color = RedPacketGold, fontSize = 12.sp)
        }
    }
}

@Composable
private fun SendRedPacketDialog(
    onDismiss: () -> Unit,
    onSend: (Int, Int, String) -> Unit,
) {
    var amount by remember { mutableStateOf("") }
    var count by remember { mutableStateOf("1") }
    var greeting by remember { mutableStateOf("") }
    var err by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("发红包") },
        text = {
            Column {
                OutlinedTextField(
                    value = amount, onValueChange = { amount = it.filter { c -> c.isDigit() } },
                    label = { Text("总金币 (1-20000)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = count, onValueChange = { count = it.filter { c -> c.isDigit() } },
                    label = { Text("红包个数 (1-100)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = greeting, onValueChange = { greeting = it.take(100) },
                    label = { Text("祝福语（可选）") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                err?.let { Text(it, color = Color(0xFFFA5151), fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val a = amount.toIntOrNull() ?: 0
                val c = count.toIntOrNull() ?: 0
                err = when {
                    a < 1 || a > 20000 -> "总金币范围 1-20000"
                    c < 1 || c > 100 -> "红包个数 1-100"
                    a < c -> "总金币不能小于红包个数"
                    else -> null
                }
                if (err == null) onSend(a, c, greeting)
            }) { Text("塞钱进红包", color = RedPacketRed) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun RedPacketDetailDialog(
    detail: com.vxin.app.data.model.RedPacketDetail,
    myId: String,
    claimedAmount: Int?,
    onClaim: () -> Unit,
    onDismiss: () -> Unit,
) {
    val mine = detail.myClaim
    val finished = detail.claimed_count >= detail.total_count
    val canClaim = mine == null && claimedAmount == null && !finished
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("🧧 ${detail.senderName.ifBlank { "好友" }} 的红包") },
        text = {
            Column {
                Text(detail.greeting.ifBlank { "恭喜发财，大吉大利" }, color = VxinTextSecondary)
                Spacer(Modifier.size(8.dp))
                when {
                    mine != null -> Text("你领取了 ${mine.amount} 金币", color = RedPacketRed, fontSize = 18.sp)
                    claimedAmount != null -> Text("你领取了 $claimedAmount 金币", color = RedPacketRed, fontSize = 18.sp)
                    finished -> Text("手慢了，红包已被领完", color = VxinTextSecondary)
                    else -> Text("点击「开」领取红包", color = VxinTextSecondary)
                }
                Spacer(Modifier.size(8.dp))
                Text("已领 ${detail.claimed_count}/${detail.total_count} 个", color = VxinTextSecondary, fontSize = 12.sp)
                if (detail.claims.isNotEmpty()) {
                    Spacer(Modifier.size(6.dp))
                    detail.claims.take(20).forEach { c ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                            Text(c.username.ifBlank { "用户" }, Modifier.weight(1f), fontSize = 13.sp)
                            Text("${c.amount} 金币", fontSize = 13.sp, color = RedPacketRed)
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (canClaim) {
                TextButton(onClick = onClaim) { Text("开", color = RedPacketRed, fontSize = 18.sp) }
            } else {
                TextButton(onClick = onDismiss) { Text("关闭") }
            }
        },
        dismissButton = {
            if (canClaim) TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )
}
