package com.vxin.app.feature.favorites

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.vxin.app.data.model.Collection
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun FavoritesScreen(
    onBack: () -> Unit,
    viewModel: FavoritesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var removeTarget by remember { mutableStateOf<Collection?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("收藏") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading && state.items.isEmpty() -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.items.isEmpty() -> Text("暂无收藏", color = VxinTextSecondary, modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.items, key = { it.id }) { item ->
                        FavoriteRow(item, resolveUrl = viewModel::resolveUrl, onLongPress = { removeTarget = item })
                        HorizontalDivider(thickness = 0.5.dp)
                    }
                }
            }
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
        }
    }

    removeTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { removeTarget = null },
            title = { Text("取消收藏") },
            text = { Text("确认取消该收藏？") },
            confirmButton = { TextButton(onClick = { viewModel.remove(target); removeTarget = null }) { Text("取消收藏") } },
            dismissButton = { TextButton(onClick = { removeTarget = null }) { Text("返回") } },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FavoriteRow(item: Collection, resolveUrl: (String?) -> String?, onLongPress: () -> Unit) {
    Column(
        Modifier.fillMaxWidth()
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        when (item.type) {
            "image" -> AsyncImage(
                model = resolveUrl(item.extra.file_url),
                contentDescription = "收藏图片",
                contentScale = ContentScale.Fit,
                modifier = Modifier.heightIn(max = 200.dp),
            )
            "file" -> Text("📄 ${item.content.ifBlank { "文件" }}", style = MaterialTheme.typography.bodyLarge)
            "video" -> Text("🎬 视频", style = MaterialTheme.typography.bodyLarge)
            else -> Text(item.content, style = MaterialTheme.typography.bodyLarge)
        }
        Text("长按可取消收藏", color = VxinTextSecondary, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
    }
}
