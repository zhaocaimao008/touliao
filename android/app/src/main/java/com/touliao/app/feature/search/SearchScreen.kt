package com.touliao.app.feature.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import com.touliao.app.ui.theme.VxinGreen
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.touliao.app.data.model.SearchResult
import com.touliao.app.ui.components.InitialAvatar
import com.touliao.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    onBack: () -> Unit,
    onOpenResult: (SearchResult) -> Unit,
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    // 进入搜索页自动聚焦并弹出键盘(对齐微信)
    val focusRequester = remember { androidx.compose.ui.focus.FocusRequester() }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(150)
        runCatching { focusRequester.requestFocus() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    OutlinedTextField(
                        value = state.query,
                        onValueChange = viewModel::onQueryChange,
                        modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
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
            Column(Modifier.fillMaxSize()) {
                // F4b 分类筛选栏：有关键词时显示（类型下拉 + 时间 chips + 可选发送人）
                if (state.query.isNotBlank()) {
                    SearchFilterBar(state = state, viewModel = viewModel)
                }
                Box(Modifier.weight(1f)) {
                    when {
                        state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                        state.query.isBlank() -> Text("输入关键词搜索聊天记录", color = VxinTextSecondary, modifier = Modifier.align(Alignment.Center))
                        state.searched && state.results.isEmpty() -> com.touliao.app.ui.components.EmptyState(icon = "🔍", title = "没有找到相关消息", modifier = Modifier.align(Alignment.Center))
                        else -> LazyColumn(Modifier.fillMaxSize()) {
                            items(state.results, key = { it.id }) { r ->
                                ResultRow(r, avatarUrl = viewModel.resolveUrl(r.otherUser?.avatar), query = state.query) { onOpenResult(r) }
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
    }
}

/** 类型/发送人下拉 + 时间 chips（对齐 Web gs-filters；发送人选项来自结果集累积） */
@Composable
private fun SearchFilterBar(state: SearchUiState, viewModel: SearchViewModel) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val typeOptions = MESSAGE_SEARCH_TYPES
            val selectedType = typeOptions.firstOrNull { it.value == state.typeFilter } ?: typeOptions.first()
            FilterDropdown(
                label = "类型",
                valueText = selectedType.label,
                options = typeOptions.map { it.label },
                onSelectIndex = { i -> viewModel.onTypeFilterChange(typeOptions[i].value) },
                modifier = Modifier.weight(1f),
            )
            if (state.senderOptions.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                val senderOptions = listOf("全部") + state.senderOptions.map { it.name.ifBlank { "成员" } }
                val selectedSender = if (state.senderId.isBlank()) "全部"
                    else state.senderOptions.firstOrNull { it.id == state.senderId }?.name?.ifBlank { "成员" } ?: "全部"
                FilterDropdown(
                    label = "发送人",
                    valueText = selectedSender,
                    options = senderOptions,
                    onSelectIndex = { i ->
                        viewModel.onSenderChange(if (i == 0) "" else state.senderOptions[i - 1].id)
                    },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Row {
            MESSAGE_SEARCH_TIME_RANGES.forEach { opt ->
                TimeChip(label = opt.label, selected = state.timeRange == opt.value) {
                    viewModel.onTimeRangeChange(opt.value)
                }
            }
        }
    }
}

@Composable
private fun FilterDropdown(
    label: String,
    valueText: String,
    options: List<String>,
    onSelectIndex: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Color(0x11000000))
                .clickable { open = true }
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("$label：", color = VxinTextSecondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2)
            Text(
                valueText,
                fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.weight(1f))
            Text("▾", color = VxinTextSecondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEachIndexed { i, opt ->
                DropdownMenuItem(text = { Text(opt) }, onClick = { onSelectIndex(i); open = false })
            }
        }
    }
}

@Composable
private fun TimeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(999.dp)
    Box(
        Modifier
            .padding(end = 8.dp)
            .clip(shape)
            .background(if (selected) VxinGreen.copy(alpha = 0.15f) else Color(0x11000000))
            .then(if (selected) Modifier.border(0.5.dp, VxinGreen.copy(alpha = 0.6f), shape) else Modifier)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 5.dp),
    ) {
        Text(label, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2, color = if (selected) VxinGreen else VxinTextSecondary)
    }
}

@Composable
private fun ResultRow(r: SearchResult, avatarUrl: String? = null, query: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = r.convName.ifBlank { "?" }, size = 44.dp, avatarUrl = avatarUrl)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(r.convName.ifBlank { "会话" }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val prefix = if (r.senderName.isNotBlank()) "${r.senderName}: " else ""
            // 类型图标 + 按类型摘要（结构化消息不泄 JSON，对齐 Web formatSearchMessageSummary）
            val typePrefix = "${messageSearchTypeIcon(r.type)} "
            val summary = formatSearchMessageSummary(r.type, r.content)
            Text(
                highlightQuery(prefix + typePrefix + summary, query, prefixLen = prefix.length + typePrefix.length),
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
