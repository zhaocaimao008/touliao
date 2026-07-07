package com.vxin.app.feature.contacts

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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.FriendRequest
import com.vxin.app.data.model.SentRequest
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendRequestsScreen(
    onBack: () -> Unit,
    viewModel: FriendRequestsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("新的朋友") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        var tab by remember { mutableIntStateOf(0) }
        Column(Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("收到") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("已发送") })
            }
            Box(Modifier.fillMaxSize()) {
                if (tab == 0) {
                    when {
                        state.loading && state.requests.isEmpty() -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                        state.requests.isEmpty() -> com.vxin.app.ui.components.EmptyState(icon = "👋", title = "没有新的好友申请", modifier = Modifier.align(Alignment.Center))
                        else -> LazyColumn(Modifier.fillMaxSize()) {
                            items(state.requests, key = { it.id }) { req ->
                                RequestRow(
                                    req = req,
                                    busy = req.id in state.handling,
                                    onAccept = { viewModel.handle(req, accept = true) },
                                    onReject = { viewModel.handle(req, accept = false) },
                                )
                            }
                        }
                    }
                } else {
                    if (state.sent.isEmpty()) {
                        Text("没有已发送的申请", color = VxinTextSecondary, modifier = Modifier.align(Alignment.Center))
                    } else {
                        LazyColumn(Modifier.fillMaxSize()) {
                            items(state.sent, key = { it.id }) { req -> SentRow(req) }
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
}

@Composable
private fun SentRow(req: SentRequest) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = req.username.ifBlank { "?" }, size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(req.username.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge)
            Text(req.message.ifBlank { "请求添加对方为好友" }, color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
        }
        Text(
            when (req.status) { "accepted" -> "已同意"; "rejected" -> "已拒绝"; else -> "等待验证" },
            color = if (req.status == "accepted") VxinGreen else VxinTextSecondary,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun RequestRow(req: FriendRequest, busy: Boolean, onAccept: () -> Unit, onReject: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = req.username.ifBlank { "?" }, size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(req.username.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge)
            Text(
                req.message.ifBlank { "请求添加你为好友" },
                color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall,
            )
        }
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        } else {
            OutlinedButton(onClick = onReject) { Text("拒绝") }
            Spacer(Modifier.width(8.dp))
            Button(onClick = onAccept, colors = ButtonDefaults.buttonColors(containerColor = VxinGreen)) { Text("接受") }
        }
    }
}
