package com.vxin.app.feature.callhistory

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.core.util.formatChatTime
import com.vxin.app.data.model.CallLog
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

private val ERR = androidx.compose.ui.graphics.Color(0xFFFA5151)

private fun statusLabel(status: String): String = when (status) {
    "completed" -> "已接通"
    "missed" -> "未接听"
    "canceled" -> "已取消"
    "rejected" -> "已拒绝"
    "ongoing" -> "通话中"
    else -> "已接通"
}

private fun fmtDuration(s: Int): String {
    if (s <= 0) return ""
    val m = s / 60; val sec = s % 60
    return if (m > 0) "${m}分${sec}秒" else "${sec}秒"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallHistoryScreen(
    onBack: () -> Unit,
    onOpenChat: (com.vxin.app.feature.contacts.ConversationTarget) -> Unit = {},
    viewModel: CallHistoryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val openChat by viewModel.openChat.collectAsStateWithLifecycle()
    androidx.compose.runtime.LaunchedEffect(openChat) {
        openChat?.let { onOpenChat(it); viewModel.consumeOpenChat() }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("通话记录") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading && state.items.isEmpty() -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.items.isEmpty() -> com.vxin.app.ui.components.EmptyState(icon = "📞", title = "暂无通话记录", subtitle = "拨打或接听后会出现在这里", modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.items, key = { it.id }) { c ->
                        CallLogRow(c, resolveUrl = viewModel::resolveUrl, onClick = { viewModel.openPeerChat(c) })
                        HorizontalDivider(Modifier.padding(start = 70.dp), thickness = 0.5.dp)
                    }
                }
            }
            state.error?.let {
                androidx.compose.runtime.LaunchedEffect(it) { kotlinx.coroutines.delay(2500); viewModel.consumeError() }
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
        }
    }
}

@Composable
private fun CallLogRow(c: CallLog, resolveUrl: (String?) -> String?, onClick: () -> Unit = {}) {
    val missed = c.direction == "in" && (c.status == "missed" || c.status == "canceled")
    Row(
        Modifier.fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = c.peer_name.ifBlank { "?" }, size = 42.dp, avatarUrl = resolveUrl(c.peer_avatar))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                c.peer_name.ifBlank { "用户" },
                fontSize = 15.sp, fontWeight = FontWeight.Medium,
                color = if (missed) ERR else MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.size(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                // 方向箭头：拨出 ↗ / 来电 ↙
                Text(if (c.direction == "out") "↗" else "↙", color = if (missed) ERR else VxinTextSecondary, fontSize = 12.sp)
                Spacer(Modifier.width(4.dp))
                val kind = if (c.type == "video") "视频通话" else "语音通话"
                val dur = fmtDuration(c.duration)
                val text = "$kind · ${statusLabel(c.status)}" + if (dur.isNotBlank()) " · $dur" else ""
                Text(text, color = if (missed) ERR else VxinTextSecondary, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(formatChatTime(c.created_at), color = VxinTextSecondary, fontSize = 11.sp)
    }
}
