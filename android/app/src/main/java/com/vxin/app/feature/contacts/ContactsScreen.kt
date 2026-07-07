package com.vxin.app.feature.contacts

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.Contact
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsScreen(
    onOpenChat: (ConversationTarget) -> Unit,
    onAddFriend: () -> Unit,
    onRequests: () -> Unit,
    onCreateGroup: () -> Unit,
    onOpenBlocked: () -> Unit = {},
    viewModel: ContactsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val openChat by viewModel.openChat.collectAsStateWithLifecycle()
    var remarkTarget by remember { mutableStateOf<Contact?>(null) }
    var deleteTarget by remember { mutableStateOf<Contact?>(null) }
    var blockTarget by remember { mutableStateOf<Contact?>(null) }

    LaunchedEffect(openChat) {
        openChat?.let { onOpenChat(it); viewModel.consumeOpenChat() }
    }
    // 返回该页时刷新（申请数/新好友）
    LaunchedEffect(Unit) { viewModel.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("通讯录") },
                actions = {
                    TextButton(onClick = onCreateGroup) { Text("群聊") }
                    IconButton(onClick = onAddFriend) {
                        Icon(Icons.Filled.Add, contentDescription = "添加好友")
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            Column(Modifier.fillMaxSize()) {
                // 新的朋友入口
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onRequests)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("新的朋友", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    if (state.requestCount > 0) {
                        BadgedBox(badge = { Badge { Text(state.requestCount.toString()) } }) {
                            Spacer(Modifier.width(8.dp))
                        }
                    }
                    Text("›", color = VxinTextSecondary)
                }
                HorizontalDivider()
                // 黑名单入口
                Row(
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onOpenBlocked).padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("黑名单", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    Text("›", color = VxinTextSecondary)
                }
                HorizontalDivider()

                when {
                    state.loading && state.contacts.isEmpty() ->
                        Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                    state.contacts.isEmpty() ->
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("还没有联系人", color = VxinTextSecondary)
                                TextButton(onClick = onAddFriend) { Text("去添加好友") }
                            }
                        }
                    else -> ContactsIndexedList(
                        contacts = state.contacts,
                        onlineIds = state.onlineIds,
                        resolveUrl = { viewModel.resolveUrl(it) },
                        onOpenChat = { viewModel.startPrivateChat(it) },
                        onRemark = { remarkTarget = it },
                        onBlock = { blockTarget = it },
                        onDelete = { deleteTarget = it },
                    )
                }
            }
            state.error?.let {
                androidx.compose.runtime.LaunchedEffect(it) { kotlinx.coroutines.delay(2500); viewModel.consumeError() }
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
        }
    }

    remarkTarget?.let { target ->
        RemarkDialog(
            initial = target.remark.orEmpty(),
            onConfirm = { viewModel.setRemark(target, it); remarkTarget = null },
            onDismiss = { remarkTarget = null },
        )
    }
    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("删除好友") },
            text = { Text("确认删除好友「${target.displayName}」？将同时删除聊天记录。") },
            confirmButton = { TextButton(onClick = { viewModel.deleteContact(target); deleteTarget = null }) { Text("删除", color = Color(0xFFFA5151)) } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("取消") } },
        )
    }
    blockTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { blockTarget = null },
            title = { Text("加入黑名单") },
            text = { Text("加入黑名单后，将不再收到「${target.displayName}」的消息。") },
            confirmButton = { TextButton(onClick = { viewModel.block(target); blockTarget = null }) { Text("加入", color = Color(0xFFFA5151)) } },
            dismissButton = { TextButton(onClick = { blockTarget = null }) { Text("取消") } },
        )
    }
}

/** 取分组字母：中文按拼音首字母近似，英文取大写首字母，其余归 # */
private fun sectionLetterOf(name: String): Char {
    val c = name.trim().firstOrNull() ?: return '#'
    return when {
        c in 'A'..'Z' -> c
        c in 'a'..'z' -> c.uppercaseChar()
        else -> pinyinFirstLetter(c)
    }
}

/** 中文首字符 → 拼音首字母（基于 GB2312 区间近似，覆盖常用汉字） */
private fun pinyinFirstLetter(c: Char): Char {
    if (c.code < 0x4E00 || c.code > 0x9FFF) return '#'
    // 各字母拼音区间的起始汉字（Unicode 码点，按拼音排序的边界）
    val boundaries = listOf(
        0x4E00 to 'A', 0x516B to 'B', 0x5693 to 'C', 0x5491 to 'D',
        0x59B1 to 'E', 0x53D1 to 'F', 0x7324 to 'G', 0x54C8 to 'H',
        0x51E0 to 'J', 0x5580 to 'K', 0x62C9 to 'L', 0x5988 to 'M',
        0x5B01 to 'N', 0x54E6 to 'O', 0x5991 to 'P', 0x671F to 'Q',
        0x7136 to 'R', 0x6492 to 'S', 0x584C to 'T', 0x7A75 to 'W',
        0x5915 to 'X', 0x4E2B to 'Y', 0x5E00 to 'Z',
    )
    var result = '#'
    for ((code, letter) in boundaries) {
        if (c.code >= code) result = letter
    }
    return result
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ContactsIndexedList(
    contacts: List<Contact>,
    onlineIds: Set<String>,
    resolveUrl: (String?) -> String?,
    onOpenChat: (Contact) -> Unit,
    onRemark: (Contact) -> Unit,
    onBlock: (Contact) -> Unit,
    onDelete: (Contact) -> Unit,
) {
    // 分组并排序：按字母分组，字母表顺序，# 归最后
    val grouped = remember(contacts) {
        contacts.groupBy { sectionLetterOf(it.displayName.ifBlank { it.username }) }
            .toSortedMap(compareBy { if (it == '#') Char.MAX_VALUE else it })
    }
    val letters = remember(grouped) { grouped.keys.toList() }
    // 每个字母首行在 LazyColumn 中的 item 索引（含 header 自身）
    val letterToIndex = remember(grouped) {
        val map = HashMap<Char, Int>()
        var idx = 0
        grouped.forEach { (letter, list) ->
            map[letter] = idx
            idx += 1 + list.size // header + rows
        }
        map
    }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    Box(Modifier.fillMaxSize()) {
        LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
            grouped.forEach { (letter, list) ->
                stickyHeader(key = "header-$letter") {
                    Text(
                        letter.toString(),
                        color = VxinTextSecondary,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                }
                items(list, key = { it.id }) { contact ->
                    ContactRow(
                        contact,
                        online = contact.id in onlineIds,
                        avatarUrl = resolveUrl(contact.avatar),
                        onClick = { onOpenChat(contact) },
                        onRemark = { onRemark(contact) },
                        onBlock = { onBlock(contact) },
                        onDelete = { onDelete(contact) },
                    )
                    HorizontalDivider(Modifier.padding(start = 76.dp), thickness = 0.5.dp)
                }
            }
        }
        // 右侧字母索引条
        if (letters.size > 3) {
            Column(
                Modifier.align(Alignment.CenterEnd).fillMaxHeight().padding(end = 2.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                letters.forEach { letter ->
                    Text(
                        letter.toString(),
                        color = VxinGreen,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier
                            .padding(horizontal = 6.dp, vertical = 1.dp)
                            .clickable {
                                letterToIndex[letter]?.let { i -> scope.launch { listState.scrollToItem(i) } }
                            },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ContactRow(
    contact: Contact,
    online: Boolean = false,
    avatarUrl: String? = null,
    onClick: () -> Unit,
    onRemark: () -> Unit = {},
    onBlock: () -> Unit = {},
    onDelete: () -> Unit = {},
) {
    var menuOpen by remember { mutableStateOf(false) }
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    Box {
    Row(
        modifier = Modifier.fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = {
                haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress); menuOpen = true
            })
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            InitialAvatar(name = contact.displayName.ifBlank { "?" }, size = 48.dp, avatarUrl = avatarUrl)
            if (online) {
                Box(
                    Modifier.align(Alignment.BottomEnd).size(12.dp)
                        .clip(CircleShape).background(Color.White).padding(2.dp)
                        .clip(CircleShape).background(VxinGreen),
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(contact.displayName.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (contact.bio.isNotBlank()) {
                Text(contact.bio, color = VxinTextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(text = { Text("设置备注") }, onClick = { onRemark(); menuOpen = false })
            DropdownMenuItem(text = { Text("加入黑名单") }, onClick = { onBlock(); menuOpen = false })
            DropdownMenuItem(text = { Text("删除好友", color = Color(0xFFFA5151)) }, onClick = { onDelete(); menuOpen = false })
        }
    }
}

@Composable
private fun RemarkDialog(initial: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("设置备注") },
        text = { OutlinedTextField(text, { text = it }, singleLine = true, modifier = Modifier.fillMaxWidth(), placeholder = { Text("留空恢复默认昵称") }) },
        confirmButton = { TextButton(onClick = { onConfirm(text) }) { Text("确定") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
