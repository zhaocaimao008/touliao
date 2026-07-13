package com.vxin.app.feature.sessions

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.DeviceSession
import com.vxin.app.ui.components.EmptyState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(onBack: () -> Unit, viewModel: SessionsViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var kickTarget by remember { mutableStateOf<DeviceSession?>(null) }
    var kickOthers by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("登录设备管理") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
                actions = {
                    if (state.sessions.count { !it.current } > 0) {
                        TextButton(onClick = { kickOthers = true }) { Text("退出其它设备") }
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.error != null && state.sessions.isEmpty() ->
                    Text(state.error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.Center))
                state.sessions.isEmpty() -> EmptyState(icon = "💻", title = "暂无登录设备", modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.sessions, key = { it.id }) { s ->
                        SessionRow(s, onKick = { kickTarget = s })
                        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
                    }
                }
            }
        }
    }

    kickTarget?.let { t ->
        AlertDialog(
            onDismissRequest = { kickTarget = null },
            title = { Text("下线该设备") },
            text = { Text("确认让「${t.device}」下线？该设备需重新登录。") },
            confirmButton = { TextButton(onClick = { viewModel.kick(t); kickTarget = null }) { Text("确认", color = Color(0xFFFA5151)) } },
            dismissButton = { TextButton(onClick = { kickTarget = null }) { Text("取消") } },
        )
    }
    if (kickOthers) {
        AlertDialog(
            onDismissRequest = { kickOthers = false },
            title = { Text("退出其它设备") },
            text = { Text("确认退出除当前设备外的所有登录？") },
            confirmButton = { TextButton(onClick = { viewModel.kickOthers(); kickOthers = false }) { Text("确认", color = Color(0xFFFA5151)) } },
            dismissButton = { TextButton(onClick = { kickOthers = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun SessionRow(s: DeviceSession, onKick: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(16.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(s.device.ifBlank { s.platform.ifBlank { "未知设备" } }, style = MaterialTheme.typography.bodyLarge)
                if (s.current) Text("  · 当前设备", color = Color(0xFF07C160), style = MaterialTheme.typography.bodySmall)
            }
            Text(
                (if (s.ip.isNotBlank()) "IP ${s.ip} · " else "") + "最近活跃 ${formatTime(s.lastSeen)}",
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall,
            )
        }
        if (!s.current) TextButton(onClick = onKick) { Text("下线", color = Color(0xFFFA5151)) }
    }
}

private fun formatTime(epochSec: Long): String =
    if (epochSec <= 0) "" else SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(epochSec * 1000))
