package com.vxin.app.feature.group

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.GroupMember
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupInfoScreen(
    onBack: () -> Unit,
    onInvite: (String) -> Unit,   // conversationId
    onLeft: () -> Unit,
    viewModel: GroupInfoViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showRename by remember { mutableStateOf(false) }
    var showLeaveConfirm by remember { mutableStateOf(false) }
    var kickTarget by remember { mutableStateOf<GroupMember?>(null) }

    LaunchedEffect(state.left) { if (state.left) onLeft() }
    // 邀请后返回刷新
    LaunchedEffect(Unit) { viewModel.refresh() }

    val info = state.info

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("群聊信息") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading && info == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                info == null -> Text(state.error ?: "加载失败", color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth()
                                .clickable(enabled = info.canManage) { showRename = true }
                                .padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("群名称", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                            Text(info.name.ifBlank { "未命名群聊" }, color = VxinTextSecondary)
                            if (info.canManage) { Spacer(Modifier.width(6.dp)); Text("›", color = VxinTextSecondary) }
                        }
                        HorizontalDivider()
                        Text(
                            "群成员 (${info.members.size})",
                            Modifier.padding(16.dp),
                            color = VxinTextSecondary,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth().clickable { onInvite(viewModel.conversationId) }.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Filled.Add, contentDescription = null, tint = VxinGreen)
                            Spacer(Modifier.width(12.dp))
                            Text("邀请成员", color = VxinGreen)
                        }
                        HorizontalDivider(Modifier.padding(start = 56.dp), thickness = 0.5.dp)
                    }
                    items(info.members, key = { it.id }) { member ->
                        MemberRow(
                            member = member,
                            canKick = info.canManage && member.role != "owner",
                            onKick = { kickTarget = member },
                        )
                        HorizontalDivider(Modifier.padding(start = 72.dp), thickness = 0.5.dp)
                    }
                    item {
                        Spacer(Modifier.size(24.dp))
                        Button(
                            onClick = { showLeaveConfirm = true },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFA5151)),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        ) { Text("退出群聊") }
                    }
                }
            }
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
        }
    }

    if (showRename && info != null) {
        RenameDialog(initial = info.name, busy = state.renaming, onConfirm = { viewModel.rename(it); showRename = false }, onDismiss = { showRename = false })
    }
    kickTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { kickTarget = null },
            title = { Text("移除成员") },
            text = { Text("确认将「${target.displayName}」移出群聊？") },
            confirmButton = { TextButton(onClick = { viewModel.kick(target); kickTarget = null }) { Text("移除") } },
            dismissButton = { TextButton(onClick = { kickTarget = null }) { Text("取消") } },
        )
    }
    if (showLeaveConfirm) {
        AlertDialog(
            onDismissRequest = { showLeaveConfirm = false },
            title = { Text("退出群聊") },
            text = { Text("退出后将不再接收该群消息。") },
            confirmButton = { TextButton(onClick = { viewModel.leave(); showLeaveConfirm = false }) { Text("退出") } },
            dismissButton = { TextButton(onClick = { showLeaveConfirm = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun MemberRow(member: GroupMember, canKick: Boolean, onKick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = member.displayName.ifBlank { "?" }, size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(member.displayName.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge)
            if (member.role != "member") {
                Text(if (member.role == "owner") "群主" else "管理员", color = VxinGreen, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (canKick) {
            TextButton(onClick = onKick) { Text("移除", color = Color(0xFFFA5151)) }
        }
    }
}

@Composable
private fun RenameDialog(initial: String, busy: Boolean, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("修改群名称") },
        text = { OutlinedTextField(name, { name = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(onClick = { onConfirm(name) }, enabled = !busy && name.isNotBlank()) { Text("确定") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
