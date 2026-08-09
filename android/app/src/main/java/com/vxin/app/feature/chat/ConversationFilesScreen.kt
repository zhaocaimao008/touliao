package com.vxin.app.feature.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.vxin.app.core.util.downloadFile
import com.vxin.app.data.model.ConversationFile
import com.vxin.app.ui.components.EmptyState
import com.vxin.app.ui.theme.VxinTextSecondary
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 功能A3: 聊天文件聚合页。
 * 顶部 tab（全部/图片/视频/文件）→ 对应后端 type；下拉分页；
 * 图片/视频点击 → 预览/外部打开；文件点击 → 下载/打开（复用现有 downloadFile）。
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterialApi::class)
@Composable
fun ConversationFilesScreen(
    onBack: () -> Unit,
    viewModel: ConversationFilesViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val gridState = rememberLazyGridState()

    // 全屏图片预览（点击图片项打开）
    var previewImage by remember { mutableStateOf<String?>(null) }

    // 自动分页：接近底部时加载更多
    val shouldLoadMore by remember {
        derivedStateOf {
            val info = gridState.layoutInfo
            val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            lastVisible >= info.totalItemsCount - 4 && info.totalItemsCount > 0
        }
    }
    LaunchedEffect(shouldLoadMore) { if (shouldLoadMore) viewModel.loadMore() }

    val pullState = rememberPullRefreshState(refreshing = state.loading, onRefresh = viewModel::loadFirst)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("聊天文件") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // 顶部 tab
            val tabs = FileTab.entries
            TabRow(selectedTabIndex = tabs.indexOf(state.tab)) {
                tabs.forEach { tab ->
                    Tab(
                        selected = state.tab == tab,
                        onClick = { viewModel.switchTab(tab) },
                        text = { Text(tab.label) },
                    )
                }
            }

            Box(Modifier.fillMaxSize().pullRefresh(pullState)) {
                when {
                    state.loading && state.items.isEmpty() ->
                        CircularProgressIndicator(Modifier.align(Alignment.Center))

                    state.error != null && state.items.isEmpty() ->
                        Text(
                            state.error!!,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.align(Alignment.Center),
                        )

                    state.items.isEmpty() ->
                        EmptyState(
                            icon = "📁",
                            title = "暂无文件",
                            subtitle = "该会话下的图片、视频与文件会在这里汇总",
                            modifier = Modifier.align(Alignment.Center),
                        )

                    else -> LazyVerticalGrid(
                        columns = GridCells.Fixed(if (state.tab == FileTab.FILE) 1 else 3),
                        state = gridState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(4.dp),
                    ) {
                        items(state.items, key = { it.id }) { file ->
                            FileGridItem(
                                file = file,
                                resolveUrl = viewModel::resolveMediaUrl,
                                onClick = {
                                    when (file.type) {
                                        "image" -> previewImage = viewModel.resolveMediaUrl(file.file_url)
                                        // 视频/文件：交由系统应用打开或下载（复用现有逻辑）
                                        else -> downloadFile(
                                            context,
                                            viewModel.resolveMediaUrl(file.file_url),
                                            file.content.ifBlank { "文件" },
                                        )
                                    }
                                },
                            )
                        }
                        if (state.loadingMore) {
                            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                                Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                }
                            }
                        }
                    }
                }

                PullRefreshIndicator(
                    refreshing = state.loading,
                    state = pullState,
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            }
        }
    }

    // 图片全屏预览
    previewImage?.let { url ->
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { previewImage = null },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Box(
                Modifier.fillMaxSize().background(Color.Black).clickable { previewImage = null },
                contentAlignment = Alignment.Center,
            ) {
                AsyncImage(model = url, contentDescription = "图片", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun FileGridItem(
    file: ConversationFile,
    resolveUrl: (String?) -> String?,
    onClick: () -> Unit,
) {
    when (file.type) {
        "image", "video" -> Box(
            Modifier
                .padding(2.dp)
                .aspectRatio(1f)
                .clip(RoundedCornerShape(com.vxin.app.ui.theme.VxinRadius.sm))
                .background(Color(0x11000000))
                .clickable(onClick = onClick),
        ) {
            AsyncImage(
                model = resolveUrl(file.file_url),
                contentDescription = if (file.type == "image") "图片" else "视频",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            // 视频角标：半透明播放标识
            if (file.type == "video") {
                Box(
                    Modifier.fillMaxSize().background(Color(0x22000000)),
                    contentAlignment = Alignment.Center,
                ) { Text("▶", color = Color.White, fontSize = 22.sp) }
            }
        }
        // 文件：图标 + 文件名 + 发送者 + 时间（单列行）
        else -> {
            val sdf = remember { SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()) }
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onClick)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("📄", fontSize = 28.sp)
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        fileNameOf(file),
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row {
                        Text(
                            file.senderName.ifBlank { "某人" },
                            fontSize = com.vxin.app.ui.theme.VxinTextSize.xs,
                            color = VxinTextSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        Spacer(Modifier.size(8.dp))
                        Text(sdf.format(Date(file.created_at * 1000)), fontSize = com.vxin.app.ui.theme.VxinTextSize.xs, color = VxinTextSecondary)
                    }
                }
            }
        }
    }
}

/** 文件名：优先 content，否则从 file_url 末段提取 */
private fun fileNameOf(file: ConversationFile): String {
    if (file.content.isNotBlank()) return file.content
    val seg = file.file_url.substringAfterLast('/').substringBefore('?')
    return seg.ifBlank { "文件" }
}
