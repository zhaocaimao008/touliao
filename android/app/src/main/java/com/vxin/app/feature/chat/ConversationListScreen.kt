package com.vxin.app.feature.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.vxin.app.core.realtime.SocketStatus
import com.vxin.app.core.util.formatChatTime
import com.vxin.app.data.model.Conversation
import com.vxin.app.ui.VxinIcons
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.material.ExperimentalMaterialApi::class)
@Composable
fun ConversationListScreen(
    onOpenConversation: (Conversation) -> Unit,
    onOpenSearch: () -> Unit = {},
    viewModel: ConversationListViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val socketStatus by viewModel.socketStatus.collectAsStateWithLifecycle()
    var clearTarget by remember { mutableStateOf<Conversation?>(null) }

    // 从聊天页返回时刷新草稿(显示/清除「[草稿]」前缀)
    LifecycleResumeEffect(Unit) {
        viewModel.refreshDrafts()
        onPauseOrDispose { }
    }

    // Android 13+ 请求通知权限（用于 FCM 推送展示）
    val context = androidx.compose.ui.platform.LocalContext.current
    val notifPermLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()
    ) { }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            notifPermLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        // 已连接时标题简洁显示「消息」；异常时才追加状态(对齐微信「收取中…」)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("消息", fontSize = 18.sp)
                            if (socketStatus != SocketStatus.CONNECTED) {
                                Spacer(Modifier.width(6.dp))
                                if (socketStatus == SocketStatus.CONNECTING) {
                                    CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = VxinTextSecondary)
                                }
                                Text(
                                    text = if (socketStatus == SocketStatus.CONNECTING) "收取中…" else "未连接",
                                    fontSize = 12.sp,
                                    color = if (socketStatus == SocketStatus.CONNECTING) VxinTextSecondary else Color(0xFFFA5151),
                                    modifier = Modifier.padding(start = 4.dp),
                                )
                            }
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onOpenSearch) {
                        Icon(VxinIcons.Search, contentDescription = "搜索")
                    }
                },
            )
        },
    ) { padding ->
        val refreshing = state.loading && state.conversations.isNotEmpty()
        val pullState = rememberPullRefreshState(refreshing = refreshing, onRefresh = { viewModel.refresh() })
        Box(modifier = Modifier.fillMaxSize().padding(padding).pullRefresh(pullState)) {
            when {
                state.loading && state.conversations.isEmpty() ->
                    CircularProgressIndicator(Modifier.align(Alignment.Center))

                state.error != null && state.conversations.isEmpty() ->
                    Text(
                        state.error!!,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.align(Alignment.Center),
                    )

                state.conversations.isEmpty() ->
                    com.vxin.app.ui.components.EmptyState(
                        icon = "💬",
                        title = "暂无会话",
                        subtitle = "去「通讯录」找好友开始聊天吧",
                        modifier = Modifier.align(Alignment.Center),
                    )

                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.conversations, key = { it.id }) { conv ->
                        ConversationRow(
                            conv,
                            avatarUrl = viewModel.resolveUrl(conv.avatar),
                            draft = state.drafts[conv.id].orEmpty(),
                            onClick = { onOpenConversation(conv) },
                            onTogglePin = { viewModel.togglePin(conv) },
                            onToggleMute = { viewModel.toggleMute(conv) },
                            onClear = { clearTarget = conv },
                            onMarkRead = { viewModel.markConversationRead(conv) },
                        )
                        HorizontalDivider(Modifier.padding(start = 76.dp), thickness = 0.5.dp)
                    }
                }
            }
            PullRefreshIndicator(refreshing, pullState, Modifier.align(Alignment.TopCenter))
        }
    }

    clearTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { clearTarget = null },
            title = { Text("清空聊天记录") },
            text = { Text("确认清空与「${target.name.ifBlank { "该会话" }}」的聊天记录？此操作不可恢复。") },
            confirmButton = { TextButton(onClick = { viewModel.clearMessages(target); clearTarget = null }) { Text("清空", color = Color(0xFFFA5151)) } },
            dismissButton = { TextButton(onClick = { clearTarget = null }) { Text("取消") } },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ConversationRow(
    conv: Conversation,
    avatarUrl: String? = null,
    draft: String = "",
    onClick: () -> Unit,
    onTogglePin: () -> Unit = {},
    onToggleMute: () -> Unit = {},
    onClear: () -> Unit = {},
    onMarkRead: () -> Unit = {},
) {
    var menuOpen by remember { mutableStateOf(false) }
    val haptic = LocalHapticFeedback.current
    Box {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("conv-item-${conv.id}")
            .combinedClickable(onClick = onClick, onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menuOpen = true })
            .background(if (conv.pinned == 1) Color(0x11000000) else Color.Transparent)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = conv.name.ifBlank { "?" }, size = 48.dp, avatarUrl = avatarUrl)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                conv.name.ifBlank { "未命名会话" },
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("conv-item-name"),
            )
            Spacer(Modifier.size(2.dp))
            if (draft.isNotBlank()) {
                // 有未发送草稿：红色「[草稿]」前缀(对齐微信/Web)
                Text(
                    text = androidx.compose.ui.text.buildAnnotatedString {
                        withStyle(androidx.compose.ui.text.SpanStyle(color = Color(0xFFFA5151))) { append("[草稿] ") }
                        append(draft)
                    },
                    color = VxinTextSecondary,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            } else {
                Text(
                    text = previewText(conv),
                    color = VxinTextSecondary,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.Center) {
            Text(formatChatTime(conv.lastTime), color = VxinTextSecondary, fontSize = 11.sp)
            Spacer(Modifier.size(4.dp))
            when {
                // 免打扰：有未读只显示小红点(不显示数字)，并保留🔕(对齐微信)
                conv.muted == 1 -> Row(verticalAlignment = Alignment.CenterVertically) {
                    if (conv.unreadCount > 0) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(Color(0xFFFA5151)))
                        Spacer(Modifier.width(4.dp))
                    }
                    Text("🔕", fontSize = 11.sp)
                }
                // 正常会话：显示未读数字角标
                conv.unreadCount > 0 -> Box(
                    modifier = Modifier
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(Color(0xFFFA5151)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (conv.unreadCount > 99) "99+" else conv.unreadCount.toString(),
                        color = Color.White, fontSize = 10.sp,
                    )
                }
            }
        }
    }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            if (conv.unreadCount > 0) {
                DropdownMenuItem(text = { Text("标为已读") }, onClick = { onMarkRead(); menuOpen = false })
            }
            DropdownMenuItem(text = { Text(if (conv.pinned == 1) "取消置顶" else "置顶") }, onClick = { onTogglePin(); menuOpen = false })
            DropdownMenuItem(text = { Text(if (conv.muted == 1) "取消免打扰" else "消息免打扰") }, onClick = { onToggleMute(); menuOpen = false })
            DropdownMenuItem(text = { Text("清空聊天记录", color = Color(0xFFFA5151)) }, onClick = { onClear(); menuOpen = false })
        }
    }
}

private fun previewText(conv: Conversation): String {
    val body = when (conv.lastMessageType) {
        null, "text" -> conv.lastMessage ?: ""
        "image" -> "[图片]"
        "voice" -> "[语音]"
        "video" -> "[视频]"
        "file" -> "[文件]"
        "red_packet" -> "[红包]"
        "sticker" -> "[表情]"
        "nudge" -> "[拍一拍]"
        "contact_card", "contact" -> "[名片]"
        else -> conv.lastMessage ?: ""
    }
    // 群聊预览加发送者名前缀(对齐微信「张三: 内容」)
    val sender = conv.lastSenderName
    return if (conv.type == "group" && !sender.isNullOrBlank() && body.isNotEmpty()) {
        "$sender: $body"
    } else body
}

