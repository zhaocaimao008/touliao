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
import androidx.compose.ui.platform.LocalContext
import com.vxin.app.core.util.downloadFile
import com.vxin.app.data.model.Collection
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun FavoritesScreen(
    onBack: (() -> Unit)? = null,   // null = 作为底部 Tab 使用（不显示返回箭头）
    viewModel: FavoritesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var removeTarget by remember { mutableStateOf<Collection?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("收藏") },
                navigationIcon = {
                    onBack?.let { cb -> IconButton(onClick = cb) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } }
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
                androidx.compose.runtime.LaunchedEffect(it) { kotlinx.coroutines.delay(2500); viewModel.consumeError() }
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
    val context = LocalContext.current
    // 文件/视频且有 url → 点击下载（与聊天窗口一致：DownloadManager 落盘、通知栏点开，不跳浏览器）
    val canDownload = (item.type == "file" || item.type == "video") && item.extra.file_url.isNotBlank()
    Column(
        Modifier.fillMaxWidth()
            .combinedClickable(
                onClick = { if (canDownload) downloadFile(context, resolveUrl(item.extra.file_url), item.content) },
                onLongClick = onLongPress,
            )
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
            "video" -> Text("🎬 ${item.content.ifBlank { "视频" }}", style = MaterialTheme.typography.bodyLarge)
            else -> Text(item.content, style = MaterialTheme.typography.bodyLarge)
        }
        Text(if (canDownload) "点击下载 · 长按取消收藏" else "长按可取消收藏",
            color = VxinTextSecondary, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
    }
}
