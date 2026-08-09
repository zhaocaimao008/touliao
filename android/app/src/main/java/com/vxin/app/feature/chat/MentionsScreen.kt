package com.vxin.app.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.MentionItem
import com.vxin.app.ui.components.EmptyState
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * @我消息聚合页。
 * 展示所有包含 @当前用户 的消息列表（含 @所有人），按时间倒序；点击跳转到对应会话。
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterialApi::class)
@Composable
fun MentionsScreen(
    onBack: () -> Unit,
    onOpenConversation: (convId: String, convName: String) -> Unit,
    viewModel: MentionsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()

    // 自动分页：滚动到底部前 3 条时触发加载更多
    val shouldLoadMore by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            lastVisible >= info.totalItemsCount - 3 && info.totalItemsCount > 0
        }
    }
    LaunchedEffect(shouldLoadMore) {
        if (shouldLoadMore) viewModel.loadMore()
    }

    val refreshing = state.loading
    val pullState = rememberPullRefreshState(
        refreshing = refreshing,
        onRefresh = viewModel::loadFirst,
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("@我的消息") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .pullRefresh(pullState),
        ) {
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
                        icon = "@",
                        title = "暂无 @我 的消息",
                        subtitle = "有人在群里 @ 你时，会在这里汇总",
                        modifier = Modifier.align(Alignment.Center),
                    )

                else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                    items(state.items, key = { it.msgId }) { item ->
                        MentionRow(
                            item = item,
                            onClick = { onOpenConversation(item.convId, item.convName) },
                        )
                        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
                    }
                    // 分页加载指示
                    if (state.loadingMore) {
                        item {
                            Box(
                                Modifier.fillMaxWidth().padding(12.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                CircularProgressIndicator(
                                    Modifier.height(20.dp),
                                    strokeWidth = 2.dp,
                                )
                            }
                        }
                    }
                }
            }

            PullRefreshIndicator(
                refreshing = refreshing,
                state = pullState,
                modifier = Modifier.align(Alignment.TopCenter),
            )
        }
    }
}

@Composable
private fun MentionRow(item: MentionItem, onClick: () -> Unit) {
    val sdf = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp, 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            // 会话名 + 时间
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.convName.ifBlank { "未知会话" },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    sdf.format(Date(item.createdAt * 1000)),
                    fontSize = com.vxin.app.ui.theme.VxinTextSize.xs,
                    color = VxinTextSecondary,
                )
            }
            // 发送者: 内容摘要
            Text(
                "${item.senderName.ifBlank { "某人" }}: ${item.content}",
                style = MaterialTheme.typography.bodySmall,
                color = VxinTextSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
