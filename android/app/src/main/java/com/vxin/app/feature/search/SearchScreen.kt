package com.vxin.app.feature.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import com.vxin.app.ui.theme.VxinGreen
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.SearchResult
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    onBack: () -> Unit,
    onOpenResult: (SearchResult) -> Unit,
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    OutlinedTextField(
                        value = state.query,
                        onValueChange = viewModel::onQueryChange,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("搜索聊天记录") },
                        singleLine = true,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.query.isBlank() -> Text("输入关键词搜索聊天记录", color = VxinTextSecondary, modifier = Modifier.align(Alignment.Center))
                state.searched && state.results.isEmpty() -> com.vxin.app.ui.components.EmptyState(icon = "🔍", title = "没有找到相关消息", modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.results, key = { it.id }) { r ->
                        ResultRow(r, query = state.query) { onOpenResult(r) }
                        HorizontalDivider(Modifier.padding(start = 72.dp), thickness = 0.5.dp)
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
private fun ResultRow(r: SearchResult, query: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = r.convName.ifBlank { "?" }, size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(r.convName.ifBlank { "会话" }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val prefix = if (r.senderName.isNotBlank()) "${r.senderName}: " else ""
            Text(
                highlightQuery(prefix + r.content, query, prefixLen = prefix.length),
                color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** 高亮文本中所有匹配 query 的片段（大小写不敏感）。prefixLen 之前的发送者名不参与高亮匹配。 */
private fun highlightQuery(text: String, query: String, prefixLen: Int = 0): AnnotatedString {
    val q = query.trim()
    if (q.isEmpty()) return AnnotatedString(text)
    return buildAnnotatedString {
        val lower = text.lowercase()
        val lq = q.lowercase()
        var i = 0
        while (i < text.length) {
            val idx = lower.indexOf(lq, i)
            if (idx < 0) { append(text.substring(i)); break }
            append(text.substring(i, idx))
            if (idx < prefixLen) {           // 命中发送者名前缀，不高亮，继续向后找
                append(text.substring(idx, idx + q.length))
            } else {
                withStyle(SpanStyle(color = VxinGreen, fontWeight = FontWeight.Bold)) {
                    append(text.substring(idx, idx + q.length))
                }
            }
            i = idx + q.length
        }
    }
}
