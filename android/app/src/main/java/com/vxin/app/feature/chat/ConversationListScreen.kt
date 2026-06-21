package com.vxin.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.core.realtime.SocketStatus
import com.vxin.app.core.util.formatChatTime
import com.vxin.app.data.model.Conversation
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationListScreen(
    onOpenConversation: (Conversation) -> Unit,
    viewModel: ConversationListViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val socketStatus by viewModel.socketStatus.collectAsStateWithLifecycle()

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
                        Text("消息", fontSize = 18.sp)
                        Text(
                            text = socketStatus.label(),
                            fontSize = 11.sp,
                            color = if (socketStatus == SocketStatus.CONNECTED) VxinGreen else VxinTextSecondary,
                        )
                    }
                },
            )
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
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
                    Text("暂无会话", color = VxinTextSecondary, modifier = Modifier.align(Alignment.Center))

                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.conversations, key = { it.id }) { conv ->
                        ConversationRow(conv, onClick = { onOpenConversation(conv) })
                        HorizontalDivider(Modifier.padding(start = 76.dp), thickness = 0.5.dp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ConversationRow(conv: Conversation, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = conv.name.ifBlank { "?" }, size = 48.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                conv.name.ifBlank { "未命名会话" },
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.size(2.dp))
            Text(
                text = previewText(conv),
                color = VxinTextSecondary,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.Center) {
            Text(formatChatTime(conv.lastTime), color = VxinTextSecondary, fontSize = 11.sp)
            if (conv.unreadCount > 0) {
                Spacer(Modifier.size(4.dp))
                Box(
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
}

private fun previewText(conv: Conversation): String = when (conv.lastMessageType) {
    null, "text" -> conv.lastMessage ?: ""
    "image" -> "[图片]"
    "voice" -> "[语音]"
    "video" -> "[视频]"
    "file" -> "[文件]"
    else -> conv.lastMessage ?: ""
}

private fun SocketStatus.label(): String = when (this) {
    SocketStatus.CONNECTED -> "已连接"
    SocketStatus.CONNECTING -> "连接中…"
    SocketStatus.DISCONNECTED -> "未连接"
}
