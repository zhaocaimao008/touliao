package com.vxin.app.feature.moments

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun MomentComposeScreen(
    onBack: () -> Unit,
    onPublished: () -> Unit,
    viewModel: MomentComposeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isNotEmpty()) viewModel.addImages(uris)
    }

    LaunchedEffect(state.done) { if (state.done) onPublished() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("发表") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
                actions = {
                    TextButton(onClick = viewModel::publish, enabled = !state.publishing) {
                        if (state.publishing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        else Text("发表", color = VxinGreen)
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            OutlinedTextField(
                value = state.content,
                onValueChange = viewModel::onContentChange,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("这一刻的想法…") },
                minLines = 3,
            )
            Spacer(Modifier.size(12.dp))
            LazyVerticalGrid(columns = GridCells.Fixed(3), modifier = Modifier.fillMaxWidth()) {
                items(state.images) { uri ->
                    Box(Modifier.padding(2.dp).aspectRatio(1f)) {
                        AsyncImage(uri, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(6.dp)))
                        Text("✕", color = Color.White, modifier = Modifier.align(Alignment.TopEnd).clip(RoundedCornerShape(8.dp)).clickable { viewModel.removeImage(uri) }.padding(horizontal = 6.dp))
                    }
                }
                if (state.images.size < 9) {
                    item {
                        Box(
                            Modifier.padding(2.dp).aspectRatio(1f).clip(RoundedCornerShape(6.dp))
                                .clickable { picker.launch("image/*") },
                            contentAlignment = Alignment.Center,
                        ) { Text("＋", color = VxinTextSecondary) }
                    }
                }
            }
            Spacer(Modifier.size(16.dp))
            Text("谁可以看", color = VxinTextSecondary)
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    "all" to "公开", "friends" to "好友", "private" to "私密",
                    "include" to "部分可见", "exclude" to "不给谁看",
                ).forEach { (v, label) ->
                    FilterChip(selected = state.visibility == v, onClick = { viewModel.setVisibility(v) }, label = { Text(label) })
                }
            }
            if (state.visibility == "include" || state.visibility == "exclude") {
                Spacer(Modifier.size(8.dp))
                TextButton(onClick = viewModel::openFriendPicker) {
                    Text(
                        if (state.visibility == "include") "选择可见好友 (${state.visibleTo.size})" else "选择不给谁看 (${state.visibleTo.size})",
                        color = VxinGreen,
                    )
                }
            }
            state.error?.let {
                Spacer(Modifier.size(12.dp))
                Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error)
            }
        }
    }

    if (state.showFriendPicker) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = viewModel::dismissFriendPicker,
            confirmButton = { TextButton(onClick = viewModel::dismissFriendPicker) { Text("确定 (${state.visibleTo.size})", color = VxinGreen) } },
            title = { Text(if (state.visibility == "include") "选择可见好友" else "选择不给谁看") },
            text = {
                if (state.friends.isEmpty()) {
                    Text("暂无好友", color = VxinTextSecondary)
                } else {
                    Column(Modifier.fillMaxWidth()) {
                        state.friends.forEach { f ->
                            val checked = state.visibleTo.contains(f.id)
                            Row(
                                Modifier.fillMaxWidth().clickable { viewModel.toggleVisibleFriend(f.id) }.padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(f.displayName.ifBlank { "用户" }, modifier = Modifier.weight(1f))
                                Text(if (checked) "✓" else "", color = VxinGreen)
                            }
                        }
                    }
                }
            },
        )
    }
}
