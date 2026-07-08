package com.vxin.app.feature.chat

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import kotlinx.coroutines.launch
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import com.vxin.app.core.util.downloadFile
import com.vxin.app.core.util.formatChatTime
import com.vxin.app.data.model.ContactCardContent
import com.vxin.app.data.model.Message
import com.vxin.app.ui.components.InitialAvatar
import kotlinx.serialization.json.Json
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinGreenDark
import com.vxin.app.ui.theme.VxinTextSecondary
import com.vxin.app.ui.theme.VxinBubbleMine
import com.vxin.app.ui.theme.VxinBubbleText
import com.vxin.app.ui.theme.VxinBubbleOtherDark
import com.vxin.app.ui.theme.VxinBubbleTextDark
import androidx.compose.foundation.isSystemInDarkTheme

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
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

    // 是否在底部附近：末项可见即视为在底(对齐微信新消息提示逻辑)
    val atBottom by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()
            last == null || last.index >= listState.layoutInfo.totalItemsCount - 2
        }
    }
    // 看历史期间累计的新消息数(悬浮提示)
    var newMsgCount by remember { mutableStateOf(0) }
    // 我方发的消息(pending)始终跟随滚底
    LaunchedEffect(state.pending.size) {
        if (totalCount > 0) listState.animateScrollToItem(totalCount - 1)
    }
    // 收到新消息：在底部则跟随，看历史则累计计数不打断
    LaunchedEffect(lastMsgId) {
        if (totalCount == 0) return@LaunchedEffect
        val mine = state.messages.lastOrNull()?.sender_id == viewModel.myId
        if (atBottom || mine) listState.animateScrollToItem(totalCount - 1)
        else newMsgCount++
    }
    // 滚回底部后清零计数
    LaunchedEffect(atBottom) { if (atBottom) newMsgCount = 0 }

    // 键盘弹出时把最新消息顶到键盘上方（对齐微信：点输入框后最后一条仍可见）
    val imeVisible = WindowInsets.isImeVisible
    LaunchedEffect(imeVisible) {
        if (imeVisible && totalCount > 0) listState.animateScrollToItem(totalCount - 1)
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
                        Text(state.title.ifBlank { "聊天" }, modifier = Modifier.testTag("chat-title"))
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
                    IconButton(onClick = { launchCall(false) }, modifier = Modifier.testTag("chat-call-audio-btn")) { Text("📞", style = MaterialTheme.typography.titleMedium) }
                    IconButton(onClick = { launchCall(true) }, modifier = Modifier.testTag("chat-call-video-btn")) { Text("📹", style = MaterialTheme.typography.titleMedium) }
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
            // 两个面板互斥：表情面板 / 功能(+)面板
            var showEmojiPanel by remember { mutableStateOf(false) }
            var showFuncPanel by remember { mutableStateOf(false) }
            LaunchedEffect(showEmojiPanel) { if (showEmojiPanel) viewModel.loadStickers() }
            // imePadding 提到整个底栏：键盘弹出时回复条/输入框/面板一起上移；
            // navigationBarsPadding 保证 edge-to-edge 下输入框不被手势条遮挡。
            Column(Modifier.imePadding().navigationBarsPadding()) {
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
                    onToggleEmoji = { showEmojiPanel = !showEmojiPanel; if (showEmojiPanel) showFuncPanel = false },
                    onToggleFunc = { showFuncPanel = !showFuncPanel; if (showFuncPanel) showEmojiPanel = false },
                    funcPanelOpen = showFuncPanel,
                    emojiPanelOpen = showEmojiPanel,
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
                if (showEmojiPanel) {
                    StickerEmojiPanel(
                        stickers = state.stickers,
                        resolveUrl = viewModel::resolveMediaUrl,
                        onEmoji = viewModel::appendEmoji,
                        onSticker = { viewModel.sendSticker(it); showEmojiPanel = false },
                    )
                }
                if (showFuncPanel) {
                    FunctionPanel(
                        onPickImage = { imagePicker.launch("image/*"); showFuncPanel = false },
                        onPickFile = { filePicker.launch("*/*"); showFuncPanel = false },
                        onRedPacket = { showRedPacketSend = true; showFuncPanel = false },
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
            } else if (!state.loading && state.messages.isEmpty() && state.pending.isEmpty()) {
                // 空会话友好提示(对齐微信「打个招呼吧」)
                com.vxin.app.ui.components.EmptyState(
                    icon = "👋",
                    title = "还没有消息",
                    subtitle = "发条消息，打个招呼吧",
                    modifier = Modifier.align(Alignment.Center),
                )
            } else {
                // 最后一条自己发的消息 id：仅在其上显示已读状态
                val lastOwnMsgId = state.messages.lastOrNull { it.sender_id == viewModel.myId }?.id
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
                    itemsIndexed(state.messages, key = { _, m -> m.id }, contentType = { _, m -> m.type }) { idx, msg ->
                        // 时间分隔：与上一条间隔超 5 分钟则显示居中时间（对齐微信）
                        val prev = state.messages.getOrNull(idx - 1)
                        if (shouldShowTime(prev?.created_at, msg.created_at)) {
                            Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    formatChatTime(msg.created_at),
                                    color = VxinTextSecondary,
                                    fontSize = 11.sp,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(Color(0x11000000))
                                        .padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        }
                        if (msg.type == "nudge") {
                            Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
                                Text(viewModel.nudgeText(msg), color = VxinTextSecondary, fontSize = 12.sp)
                            }
                            return@itemsIndexed
                        }
                        val isMine = msg.sender_id == viewModel.myId
                        // 只在「最后一条自己发的消息」上显示已读状态(对齐微信,减少噪音)
                        val showReadStatus = isMine && msg.id == lastOwnMsgId
                        MessageBubble(
                            msg = msg,
                            isMine = isMine,
                            showReadStatus = showReadStatus,
                            onNudge = { viewModel.nudge(msg.sender_id) },
                            isRead = isMine && viewModel.isReadByPeer(msg),
                            resolveUrl = viewModel::resolveMediaUrl,
                            onPlayVoice = { viewModel.playVoice(msg.file_url) },
                            onOpenFile = { downloadFile(context, viewModel.resolveMediaUrl(msg.file_url), msg.content) },
                            onReply = { viewModel.startReply(msg) },
                            onRecall = { viewModel.recall(msg) },
                            onVanish = { viewModel.vanish(msg) },
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
                        PendingBubble(
                            p,
                            onRetry = { viewModel.retryPending(p.tempId) },
                            onDismiss = { viewModel.dismissFailedPending(p.tempId) },
                        )
                    }
                }
            }
            // 「↓ N 条新消息」悬浮按钮：看历史时来了新消息才显示，点按滚到底(对齐微信)
            androidx.compose.animation.AnimatedVisibility(
                visible = newMsgCount > 0,
                modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
                enter = androidx.compose.animation.fadeIn() + androidx.compose.animation.slideInHorizontally { it },
                exit = androidx.compose.animation.fadeOut() + androidx.compose.animation.slideOutHorizontally { it },
            ) {
                Surface(
                    shape = RoundedCornerShape(50),
                    color = Color.White,
                    shadowElevation = 4.dp,
                    modifier = Modifier.clickable {
                        scope.launch { if (totalCount > 0) listState.animateScrollToItem(totalCount - 1) }
                        newMsgCount = 0
                    },
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("↓", color = VxinGreen, fontSize = 13.sp)
                        Spacer(Modifier.width(4.dp))
                        Text("$newMsgCount 条新消息", color = VxinGreen, fontSize = 13.sp)
                    }
                }
            }
          }
          }
            state.error?.let {
                LaunchedEffect(it) { kotlinx.coroutines.delay(2500); viewModel.consumeError() }
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
                            InitialAvatar(name = conv.name.ifBlank { "?" }, size = 32.dp, avatarUrl = viewModel.resolveMediaUrl(conv.avatar))
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
                            InitialAvatar(name = m.displayName.ifBlank { "?" }, size = 32.dp, avatarUrl = viewModel.resolveMediaUrl(m.avatar))
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
    "sticker" -> "[表情]"; "contact_card", "contact" -> "[名片]"
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
    showReadStatus: Boolean = false,
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
    onVanish: () -> Unit = {},
) {
    var menuOpen by remember { mutableStateOf(false) }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val highlightBg = if (highlighted) Color(0x3307C160) else Color.Transparent

    Row(
        modifier = Modifier.fillMaxWidth().testTag("msg-bubble-${msg.id}").background(highlightBg).padding(vertical = 2.dp),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        if (!isMine) {
            Box(Modifier.combinedClickable(onClick = {}, onDoubleClick = onNudge)) {
                InitialAvatar(name = msg.senderName.ifBlank { "?" }, size = 36.dp, avatarUrl = resolveUrl(msg.senderAvatar))
            }
            Spacer(Modifier.size(6.dp))
        }
        Column(horizontalAlignment = if (isMine) Alignment.End else Alignment.Start) {
            if (!isMine && msg.senderName.isNotBlank()) {
                Text(msg.senderName, color = VxinTextSecondary, style = MaterialTheme.typography.labelSmall)
            }
            if (isMine && showReadStatus) {
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
            val haptic = LocalHapticFeedback.current
            // 长按缩放反馈：菜单打开时气泡轻微缩小(对齐微信长按手感)
            val bubbleScale by animateFloatAsState(if (menuOpen) 0.96f else 1f, label = "bubbleScale")
            Box {
                Box(
                    Modifier
                        .graphicsLayer { scaleX = bubbleScale; scaleY = bubbleScale }
                        .combinedClickable(onClick = {}, onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menuOpen = true }),
                ) {
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
                        DropdownMenuItem(text = { Text("删除不留痕迹", color = Color(0xFFFA5151)) }, onClick = { onVanish(); menuOpen = false })
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
    "red_packet" -> "[红包]"; "sticker" -> "[表情]"; "contact_card", "contact" -> "[名片]"
    else -> rt.content
}

private fun replyPreviewOf(msg: Message): String = when (msg.type) {
    "image" -> "[图片]"; "voice" -> "[语音]"; "video" -> "[视频]"; "file" -> "[文件]"
    "red_packet" -> "[红包]"; "sticker" -> "[表情]"; "contact_card", "contact" -> "[名片]"
    else -> msg.content
}

private val contactCardJson = Json { ignoreUnknownKeys = true }
private fun parseContactCard(content: String): ContactCardContent =
    runCatching { contactCardJson.decodeFromString<ContactCardContent>(content) }.getOrNull() ?: ContactCardContent()

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
                "image" -> SubcomposeAsyncImage(
                    model = resolveUrl(msg.file_url),
                    contentDescription = "图片",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .widthIn(max = 220.dp)
                        .heightIn(max = 280.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onImageClick() },
                    loading = {
                        // 加载中灰底占位 + 转圈(对齐微信,避免空白闪烁)
                        Box(Modifier.size(140.dp).background(Color(0x11000000)), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        }
                    },
                    error = {
                        Box(Modifier.size(140.dp).background(Color(0x11000000)), contentAlignment = Alignment.Center) {
                            Text("图片加载失败", color = VxinTextSecondary, fontSize = 12.sp)
                        }
                    },
                )
                "voice" -> MediaCard(isMine, onClick = onPlayVoice) { Text(if (isMine) "🎙 语音  ▶" else "▶  🎙 语音", color = bubbleTextColor(isMine)) }
                "file" -> MediaCard(isMine, onClick = onOpenFile) {
                    Text("📄 ${msg.content.ifBlank { "文件" }}", color = bubbleTextColor(isMine), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                "video" -> MediaCard(isMine, onClick = onOpenFile) { Text("🎬 视频", color = bubbleTextColor(isMine)) }
                "contact_card", "contact" -> {
                    val card = parseContactCard(msg.content)
                    MediaCard(isMine, onClick = {}) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            InitialAvatar(card.username.ifBlank { "?" }, size = 40.dp)
                            Spacer(Modifier.size(10.dp))
                            Column {
                                Text(card.username.ifBlank { "用户" }, color = bubbleTextColor(isMine))
                                Text("个人名片", color = bubbleTextColor(isMine).copy(alpha = 0.6f), fontSize = 11.sp)
                            }
                        }
                    }
                }
                else -> TextBubble(msg.content, isMine)
            }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun PendingBubble(p: PendingUpload, onRetry: () -> Unit, onDismiss: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
        // 失败时：气泡左侧显示红色感叹号，点击重试（对齐微信）
        if (p.failed) {
            Box(
                Modifier.size(20.dp).clip(CircleShape).background(Color(0xFFFA5151))
                    .clickable { onRetry() },
                contentAlignment = Alignment.Center,
            ) { Text("!", color = Color.White, fontSize = 13.sp) }
            Spacer(Modifier.size(6.dp))
        }
        Column(horizontalAlignment = Alignment.End) {
            Box(
                modifier = Modifier
                    .widthIn(max = 220.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (p.failed) Color(0x33FA5151) else VxinGreen.copy(alpha = 0.6f))
                    .combinedClickable(
                        onClick = { if (p.failed) onRetry() },
                        onLongClick = { if (p.failed) onDismiss() },
                    )
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
                            if (p.failed) "发送失败（点击重试，长按移除）" else placeholderLabel(p),
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

/** 是否需要显示时间分隔：首条 或 与上一条间隔超 5 分钟 */
private fun shouldShowTime(prevSec: Long?, curSec: Long): Boolean {
    if (curSec <= 0) return false
    if (prevSec == null || prevSec <= 0) return true
    return curSec - prevSec >= 5 * 60
}

@Composable
private fun MessageInputBar(
    value: String,
    sending: Boolean,
    recording: Boolean,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onToggleEmoji: () -> Unit,
    onToggleFunc: () -> Unit,
    funcPanelOpen: Boolean,
    emojiPanelOpen: Boolean,
    onMicClick: () -> Unit,
    showMention: Boolean = false,
    onMention: () -> Unit = {},
) {
    val hasText = value.isNotBlank()
    // 注意：imePadding / navigationBarsPadding 已在 ChatScreen 的 bottomBar 顶层统一处理，此处不再重复。
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
        // 输入区顶部细分隔线：视觉上区分对话区与输入区（对齐微信）
        HorizontalDivider(thickness = 0.5.dp, color = VxinTextSecondary.copy(alpha = 0.2f))
        if (recording) {
            Text(
                "● 录音中…点击麦克风停止并发送",
                color = Color(0xFFFA5151),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            // 语音输入切换（对齐微信左侧麦克风）
            IconButton(onClick = onMicClick, modifier = Modifier.testTag("chat-voice-btn")) {
                Text(if (recording) "⏹" else "🎤", style = MaterialTheme.typography.titleMedium)
            }
            if (showMention) {
                IconButton(onClick = onMention) { Text("@", style = MaterialTheme.typography.titleMedium) }
            }
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f).testTag("chat-msg-input"),
                placeholder = { Text("输入消息…") },
                maxLines = 4,
            )
            Spacer(Modifier.size(2.dp))
            // 表情面板切换
            IconButton(onClick = onToggleEmoji, modifier = Modifier.testTag("chat-emoji-btn")) {
                Text(if (emojiPanelOpen) "⌨" else "😀", style = MaterialTheme.typography.titleMedium)
            }
            // 有文字 → 发送键；无文字 → +(功能面板)。对齐微信输入栏交互。
            if (hasText || sending) {
                IconButton(onClick = onSend, enabled = hasText && !sending, modifier = Modifier.testTag("chat-send-btn")) {
                    if (sending) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            Icons.AutoMirrored.Filled.Send,
                            contentDescription = "发送",
                            tint = VxinGreen,
                        )
                    }
                }
            } else {
                IconButton(onClick = onToggleFunc, modifier = Modifier.testTag("chat-more-btn")) {
                    Text(
                        if (funcPanelOpen) "✕" else "＋",
                        style = MaterialTheme.typography.titleLarge,
                        color = VxinTextSecondary,
                    )
                }
            }
        }
    }
}

/** +面板：图片 / 文件 / 红包（对齐微信「更多功能」面板） */
@Composable
private fun FunctionPanel(
    onPickImage: () -> Unit,
    onPickFile: () -> Unit,
    onRedPacket: () -> Unit,
) {
    val items = listOf(
        Triple("🖼", "图片", onPickImage),
        Triple("📎", "文件", onPickFile),
        Triple("🧧", "红包", onRedPacket),
    )
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 220.dp)
            .background(Color(0xFFF2F2F2))
            .padding(vertical = 12.dp),
    ) {
        gridItems(items) { (emoji, label, onClick) ->
            val tag = when (label) { "图片" -> "chat-attach-image"; "文件" -> "chat-attach-file"; else -> "chat-attach-redpacket" }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(vertical = 8.dp).testTag(tag).clickable(onClick = onClick),
            ) {
                Box(
                    Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(Color.White),
                    contentAlignment = Alignment.Center,
                ) { Text(emoji, fontSize = 26.sp) }
                Spacer(Modifier.size(6.dp))
                Text(label, fontSize = 12.sp, color = VxinTextSecondary)
            }
        }
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
