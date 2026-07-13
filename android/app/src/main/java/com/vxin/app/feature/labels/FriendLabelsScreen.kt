package com.vxin.app.feature.labels

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
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
import com.vxin.app.data.model.FriendLabel
import com.vxin.app.ui.components.EmptyState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendLabelsScreen(onBack: () -> Unit, viewModel: FriendLabelsViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showCreate by remember { mutableStateOf(false) }
    var editLabel by remember { mutableStateOf<FriendLabel?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("好友标签") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showCreate = true }) { Icon(Icons.Filled.Add, contentDescription = "新建标签") }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.error != null && state.labels.isEmpty() ->
                    Text(state.error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.Center))
                state.labels.isEmpty() -> EmptyState(icon = "🏷️", title = "还没有标签", subtitle = "点右下角 + 新建标签给好友分组", modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.labels, key = { it.id }) { label ->
                        LabelRow(
                            label = label,
                            onEditMembers = { editLabel = label },
                            onDelete = { viewModel.deleteLabel(label.id) },
                        )
                        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
                    }
                }
            }
        }
    }

    if (showCreate) {
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text("新建标签") },
            text = { OutlinedTextField(name, { name = it }, label = { Text("标签名（≤20字）") }, singleLine = true) },
            confirmButton = { TextButton(onClick = { viewModel.createLabel(name); showCreate = false }, enabled = name.isNotBlank()) { Text("创建") } },
            dismissButton = { TextButton(onClick = { showCreate = false }) { Text("取消") } },
        )
    }

    editLabel?.let { label ->
        val memberIds = remember(label) { label.members.map { it.id }.toSet() }
        AlertDialog(
            onDismissRequest = { editLabel = null },
            title = { Text("编辑「${label.name}」成员") },
            text = {
                LazyColumn(Modifier.heightIn(max = 380.dp)) {
                    items(state.contacts, key = { it.id }) { c ->
                        val checked = memberIds.contains(c.id)
                        Row(
                            Modifier.fillMaxWidth().clickable { viewModel.toggleMember(label.id, c.id, !checked) }.padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = checked, onCheckedChange = { viewModel.toggleMember(label.id, c.id, it) })
                            Spacer(Modifier.size(8.dp))
                            Text(c.displayName.ifBlank { "未命名" })
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { editLabel = null }) { Text("完成") } },
        )
    }
}

@Composable
private fun LabelRow(label: FriendLabel, onEditMembers: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable { onEditMembers() }.padding(16.dp, 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(12.dp).padding(0.dp)) {
            Text("●", color = runCatching { Color(android.graphics.Color.parseColor(label.color)) }.getOrDefault(Color(0xFF07C160)))
        }
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
            Text(label.name.ifBlank { "未命名标签" }, style = MaterialTheme.typography.bodyLarge)
            Text("${label.members.size} 位好友", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        TextButton(onClick = onDelete) { Text("删除", color = Color(0xFFFA5151)) }
    }
}
