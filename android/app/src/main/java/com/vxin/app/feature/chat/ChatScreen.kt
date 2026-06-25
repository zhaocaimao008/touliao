package com.vxin.app.feature.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import kotlinx.coroutines.launch
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
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
import com.vxin.app.ui.theme.VxinGreenDark
import com.vxin.app.ui.theme.VxinTextSecondary
import com.vxin.app.ui.theme.VxinBubbleMine
import com.vxin.app.ui.theme.VxinBubbleText
import com.vxin.app.ui.theme.VxinBubbleOtherDark
import com.vxin.app.ui.theme.VxinBubbleTextDark
import androidx.compose.foundation.isSystemInDarkTheme

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
    var editTarget by remember { mutableStateOf<Message?>(null) }
    var forwardTarget by remember { mutableStateOf<Message?>(null) }
    var galleryImages by remember { mutableStateOf<List<String>?>(null) }
    var galleryStart by remember { mutableStateOf(0) }
    var highlightedMsgId by remember { mutableStateOf<String?>(null) }
    var showMentionPicker by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    // 通话发起：先申请权限再拨打
    var pendingCallVideo by remember { mutableStateOf<Boolean?>(null) }
    val callPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        val v = pendingCallVideo
        pendingCallVideo = null
        if (v != null && res.values.all { it }) {
            if (viewModel.isGroup) viewModel.startGroupCall(v) else viewModel.startCall(v)
        }
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
    val backgroundPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.setBackground(it) }
    }
    var showChatMenu by remember { mutableStateOf(false) }

    // 仅在「最新一条变化」或上传项变化时滚到底，避免加载更早(前插)时跳动
    val lastMsgId = state.messages.lastOrNull()?.id
    val totalCount = state.messages.size + state.pending.size
    LaunchedEffect(lastMsgId, state.pending.size) {
        if (totalCount > 0) listState.animateScrollToItem(totalCount - 1)
    }

    // 退出聊天：发送已读 + stop_typing
    DisposableEffect(Unit) {
        onDispose { viewModel.onLeave() }
    }
    // 被踢/群解散 → 自动返回
    LaunchedEffect(state.closed) { if (state.closed) onBack() }

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
                    IconButton(onClick = { launchCall(false) }) { Text("📞", style = MaterialTheme.typography.titleMedium) }
                    IconButton(onClick = { launchCall(true) }) { Text("📹", style = MaterialTheme.typography.titleMedium) }
                    if (viewModel.isGroup) {
                        IconButton(onClick = { onOpenGroupInfo(viewModel.conversationId) }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "群聊信息")
                        }
                    }
                    // 聊天背景设置
                    Box {
                        IconButton(onClick = { showChatMenu = true }) { Text("🖼", style = MaterialTheme.typography.titleMedium) }
                        DropdownMenu(expanded = showChatMenu, onDismissRequest = { showChatMenu = false }) {
                            DropdownMenuItem(text = { Text(if (state.background.isBlank()) "设置聊天背景" else "更换聊天背景") }, onClick = {
                                showChatMenu = false; backgroundPicker.launch("image/*")
                            })
                            if (state.background.isNotBlank()) {
                                DropdownMenuItem(text = { Text("清除聊天背景", color = Color(0xFFFA5151)) }, onClick = {
                                    showChatMenu = false; viewModel.clearBackground()
                                })
                            }
                        }
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
                    showMention = viewModel.isGroup,
                    onMention = { showMentionPicker = true },
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
          if (state.background.isNotBlank()) {
              AsyncImage(
                  model = viewModel.resolveMediaUrl(state.background),
                  contentDescription = null,
                  contentScale = ContentScale.Crop,
                  modifier = Modifier.fillMaxSize(),
              )
          }
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
                    if (!state.reachedStart && state.messages.isNotEmpty()) {
                        item(key = "load_earlier") {
                            Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                                if (state.loadingEarlier) {
                                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                } else {
                                    Text("查看更早消息", color = VxinGreen, modifier = Modifier.clickable { viewModel.loadEarlier() }.padding(8.dp))
                                }
                            }
                        }
                    }
                    items(state.messages, key = { it.id }) { msg ->
                        if (msg.type == "nudge") {
                            Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
                                Text(viewModel.nudgeText(msg), color = VxinTextSecondary, fontSize = 12.sp)
                            }
                            return@items
                        }
                        val isMine = msg.sender_id == viewModel.myId
                        MessageBubble(
                            msg = msg,
                            isMine = isMine,
                            onNudge = { viewModel.nudge(msg.sender_id) },
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
                            canEdit = viewModel.canEdit(msg),
                            onEdit = { editTarget = msg },
                            onForward = { forwardTarget = msg; viewModel.loadForwardTargets() },
                            onCollect = { viewModel.collectMessage(msg) },
                            highlighted = highlightedMsgId == msg.id,
                            onImageClick = {
                                val imgs = state.messages.filter { it.type == "image" }
                                galleryImages = imgs.mapNotNull { viewModel.resolveMediaUrl(it.file_url) }
                                galleryStart = imgs.indexOfFirst { it.id == msg.id }.coerceAtLeast(0)
                            },
                            onReplyClick = { targetId ->
                                val headerOffset = if (!state.reachedStart && state.messages.isNotEmpty()) 1 else 0
                                val idx = state.messages.indexOfFirst { it.id == targetId }
                                if (idx >= 0) {
                                    scope.launch { listState.animateScrollToItem(idx + headerOffset) }
                                    highlightedMsgId = targetId
                                    scope.launch { kotlinx.coroutines.delay(1500); if (highlightedMsgId == targetId) highlightedMsgId = null }
                                }
                            },
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

    editTarget?.let { target ->
        var text by remember(target.id) { mutableStateOf(target.content) }
        AlertDialog(
            onDismissRequest = { editTarget = null },
            title = { Text("编辑消息") },
            text = { OutlinedTextField(text, { text = it }, modifier = Modifier.fillMaxWidth(), minLines = 1) },
            confirmButton = { TextButton(onClick = { viewModel.editMessage(target, text); editTarget = null }, enabled = text.isNotBlank()) { Text("保存") } },
            dismissButton = { TextButton(onClick = { editTarget = null }) { Text("取消") } },
        )
    }

    forwardTarget?.let { target ->
        var selected by remember(target.id) { mutableStateOf(setOf<String>()) }
        AlertDialog(
            onDismissRequest = { forwardTarget = null },
            title = { Text("转发到") },
            text = {
                androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(state.forwardTargets, key = { it.id }) { conv ->
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                selected = if (conv.id in selected) selected - conv.id else selected + conv.id
                            }.padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(if (conv.id in selected) "☑" else "☐", Modifier.padding(end = 8.dp))
                            InitialAvatar(name = conv.name.ifBlank { "?" }, size = 32.dp)
                            Spacer(Modifier.size(8.dp))
                            Text(conv.name.ifBlank { "未命名会话" }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { viewModel.forward(target, selected.toList()); forwardTarget = null }, enabled = selected.isNotEmpty()) { Text("转发") } },
            dismissButton = { TextButton(onClick = { forwardTarget = null }) { Text("取消") } },
        )
    }

    galleryImages?.let { imgs ->
        if (imgs.isNotEmpty()) ChatImageGallery(images = imgs, startIndex = galleryStart, onDismiss = { galleryImages = null })
    }

    if (showMentionPicker) {
        AlertDialog(
            onDismissRequest = { showMentionPicker = false },
            title = { Text("选择要 @ 的成员") },
            text = {
                androidx.compose.foundation.lazy.LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(state.groupMembers, key = { it.id }) { m ->
                        Row(
                            Modifier.fillMaxWidth().clickable { viewModel.appendMention(m); showMentionPicker = false }.padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            InitialAvatar(name = m.displayName.ifBlank { "?" }, size = 32.dp)
                            Spacer(Modifier.size(8.dp))
                            Text(m.displayName.ifBlank { "未命名" })
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showMentionPicker = false }) { Text("取消") } },
        )
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ChatImageGallery(images: List<String>, startIndex: Int, onDismiss: () -> Unit) {
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val pagerState = androidx.compose.foundation.pager.rememberPagerState(
            initialPage = startIndex.coerceIn(0, (images.size - 1).coerceAtLeast(0)), pageCount = { images.size },
        )
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            androidx.compose.foundation.pager.HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
                var scale by remember { mutableStateOf(1f) }
                Box(Modifier.fillMaxSize().clickable { onDismiss() }, contentAlignment = Alignment.Center) {
                    AsyncImage(
                        model = images[page],
                        contentDescription = "图片",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                            .graphicsLayer(scaleX = scale, scaleY = scale)
                            .pointerInput(Unit) { detectTransformGestures { _, _, zoom, _ -> scale = (scale * zoom).coerceIn(1f, 4f) } },
                    )
                }
            }
            if (images.size > 1) {
                Text("${pagerState.currentPage + 1}/${images.size}", color = Color.White, fontSize = 13.sp,
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 40.dp))
            }
        }
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
    canEdit: Boolean = false,
    onEdit: () -> Unit = {},
    onForward: () -> Unit = {},
    onCollect: () -> Unit = {},
    onImageClick: () -> Unit = {},
    onNudge: () -> Unit = {},
    highlighted: Boolean = false,
    onReplyClick: (String) -> Unit = {},
) {
    var menuOpen by remember { mutableStateOf(false) }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val highlightBg = if (highlighted) Color(0x3307C160) else Color.Transparent

    Row(
        modifier = Modifier.fillMaxWidth().background(highlightBg).padding(vertical = 2.dp),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        if (!isMine) {
            Box(Modifier.combinedClickable(onClick = {}, onDoubleClick = onNudge)) {
                InitialAvatar(name = msg.senderName.ifBlank { "?" }, size = 36.dp)
            }
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
                        .background(Color(0x11000000))
                        .clickable { rt.id.takeIf { it.isNotBlank() }?.let(onReplyClick) }
                        .padding(horizontal = 8.dp, vertical = 4.dp),
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
                    MessageContent(msg, isMine, resolveUrl, onPlayVoice, onOpenFile, onImageClick)
                }
                // (highlight via Row background above)
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
                    if (msg.type != "red_packet") {
                        DropdownMenuItem(text = { Text("转发") }, onClick = { onForward(); menuOpen = false })
                    }
                    if (canEdit) {
                        DropdownMenuItem(text = { Text("编辑") }, onClick = { onEdit(); menuOpen = false })
                    }
                    if (canPin) {
                        DropdownMenuItem(text = { Text(if (isPinned) "取消置顶" else "置顶") }, onClick = { onTogglePin(); menuOpen = false })
                    }
                    if (msg.type != "red_packet") {
                        DropdownMenuItem(text = { Text("收藏") }, onClick = { onCollect(); menuOpen = false })
                    }
                    if (msg.type == "image") {
                        DropdownMenuItem(text = { Text("收藏表情") }, onClick = { onCollectSticker(); menuOpen = false })
                    }
                    if (isMine) {
                        DropdownMenuItem(text = { Text("撤回", color = Color(0xFFFA5151)) }, onClick = { onRecall(); menuOpen = false })
                    }
                }
            }
            if (msg.edited == 1) {
                Text("已编辑", color = VxinTextSecondary, fontSize = 10.sp)
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
    onImageClick: () -> Unit = {},
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
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onImageClick() },
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
            .background(bubbleBg(isMine))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(highlightMentions(content, isMine), color = bubbleTextColor(isMine))
    }
}

private val MENTION_RE = Regex("@[^\\s@]+")

/** 高亮文本中的 @用户名 */
private fun highlightMentions(content: String, isMine: Boolean): androidx.compose.ui.text.AnnotatedString {
    if (!content.contains('@')) return androidx.compose.ui.text.AnnotatedString(content)
    val color = VxinGreenDark   // @提及高亮：浅绿/白气泡上都用深绿，保证可读
    return androidx.compose.ui.text.buildAnnotatedString {
        var last = 0
        MENTION_RE.findAll(content).forEach { mr ->
            append(content.substring(last, mr.range.first))
            withStyle(androidx.compose.ui.text.SpanStyle(color = color, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)) {
                append(mr.value)
            }
            last = mr.range.last + 1
        }
        if (last < content.length) append(content.substring(last))
    }
}

@Composable
private fun MediaCard(isMine: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .widthIn(max = 240.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(bubbleBg(isMine))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) { content() }
}

// 气泡背景：对齐 web/微信——我的=浅绿；对方=白(暗色下深灰)
@Composable
private fun bubbleBg(isMine: Boolean): Color =
    if (isMine) VxinBubbleMine
    else if (isSystemInDarkTheme()) VxinBubbleOtherDark else Color.White

// 气泡文字：浅绿/白底上都用深字(暗色下对方气泡用浅字)
@Composable
private fun bubbleTextColor(isMine: Boolean): Color =
    if (isMine) VxinBubbleText
    else if (isSystemInDarkTheme()) VxinBubbleTextDark else VxinBubbleText

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
    showMention: Boolean = false,
    onMention: () -> Unit = {},
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
            if (showMention) IconButton(onClick = onMention) { Text("@", style = MaterialTheme.typography.titleMedium) }
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
