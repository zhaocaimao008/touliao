package com.touliao.app.feature.contacts

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
import com.touliao.app.ui.TouliaoIcons
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
import com.touliao.app.data.model.Contact
import com.touliao.app.ui.components.InitialAvatar
import androidx.compose.foundation.isSystemInDarkTheme
import com.touliao.app.ui.theme.VxinBrand
import com.touliao.app.ui.theme.VxinSurfaceDark
import com.touliao.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsScreen(
    onOpenChat: (ConversationTarget) -> Unit,
    onAddFriend: () -> Unit,
    onRequests: () -> Unit,
    onCreateGroup: () -> Unit,
    onOpenBlocked: () -> Unit = {},
    onOpenLabels: () -> Unit = {},
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
                title = { Text("通讯录", style = androidx.compose.material3.MaterialTheme.typography.headlineMedium) },
                actions = {
                    TextButton(onClick = onCreateGroup) { Text("群聊") }
                    IconButton(onClick = onAddFriend) {
                        Icon(TouliaoIcons.Add, contentDescription = "添加好友")
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
                    com.touliao.app.ui.TouliaoGlyph(com.touliao.app.ui.TouliaoIcons.Disclosure, color = VxinTextSecondary, size = com.touliao.app.ui.IconSize.Xs)
                }
                HorizontalDivider()
                // 好友标签入口
                Row(
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onOpenLabels).padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("好友标签", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    com.touliao.app.ui.TouliaoGlyph(com.touliao.app.ui.TouliaoIcons.Disclosure, color = VxinTextSecondary, size = com.touliao.app.ui.IconSize.Xs)
                }
                HorizontalDivider()
                // 黑名单入口
                Row(
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onOpenBlocked).padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("黑名单", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    com.touliao.app.ui.TouliaoGlyph(com.touliao.app.ui.TouliaoIcons.Disclosure, color = VxinTextSecondary, size = com.touliao.app.ui.IconSize.Xs)
                }
                HorizontalDivider()
                // AI 助手入口（固定分组；bot 列表来自后端 /api/config）
                Row(
                    modifier = Modifier.fillMaxWidth().clickable(onClick = viewModel::toggleAiBots).padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (state.showAiBots) "AI 助手 (${state.aiBots.size})" else "AI 助手",
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    com.touliao.app.ui.TouliaoGlyph(if (state.showAiBots) com.touliao.app.ui.TouliaoIcons.Collapse else com.touliao.app.ui.TouliaoIcons.Disclosure, color = VxinTextSecondary, size = com.touliao.app.ui.IconSize.Xs)
                }
                HorizontalDivider()
                if (state.showAiBots) {
                    if (state.aiBots.isEmpty()) {
                        Text("暂无 AI 助手", color = VxinTextSecondary, modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
                    } else {
                        state.aiBots.forEach { bot ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable(onClick = { viewModel.startAiChat(bot) })
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                InitialAvatar(name = bot.name.ifBlank { "?" }, size = 40.dp, avatarUrl = bot.avatar)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(bot.name.ifBlank { bot.username }, style = MaterialTheme.typography.bodyLarge)
                                    if (bot.description.isNotBlank()) {
                                        Text(
                                            bot.description,
                                            color = VxinTextSecondary,
                                            style = MaterialTheme.typography.bodySmall,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                }
                                com.touliao.app.ui.TouliaoGlyph(com.touliao.app.ui.TouliaoIcons.Disclosure, color = VxinTextSecondary, size = com.touliao.app.ui.IconSize.Xs)
                            }
                        }
                    }
                    HorizontalDivider()
                }

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
            confirmButton = { TextButton(onClick = { viewModel.deleteContact(target); deleteTarget = null }) { Text("删除", color = com.touliao.app.ui.theme.VxinError) } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("取消") } },
        )
    }
    blockTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { blockTarget = null },
            title = { Text("加入黑名单") },
            text = { Text("加入黑名单后，将阻止与「${target.displayName}」的私聊及好友申请，双方动态不可见；共同群聊和已有历史仍可能可见。") },
            confirmButton = { TextButton(onClick = { viewModel.block(target); blockTarget = null }) { Text("加入", color = com.touliao.app.ui.theme.VxinError) } },
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

/**
 * 中文首字符 → 拼音首字母。
 * 原实现按 Unicode 码点区间推算，但 Unicode 汉字按部首笔画排列、与拼音无关，
 * 导致「产」「李」「陈」等被分进 Y/Z 组。现改为：
 *  - Android 10+：系统 ICU 汉字转拉丁（覆盖生僻字、多音字取常用读音）
 *  - 更低版本：GB2312 一级汉字（按拼音排序）编码区间表，覆盖 3755 个常用字
 */
private fun pinyinFirstLetter(c: Char): Char {
    if (c.code < 0x3400 || c.code > 0x9FFF) return '#'
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
        val latin = runCatching { hanToLatin.transliterate(c.toString()) }.getOrNull()
        val first = latin?.firstOrNull { it.isLetter() }?.uppercaseChar()
        if (first != null && first in 'A'..'Z') return first
    }
    return gb2312FirstLetter(c)
}

private val hanToLatin by lazy {
    android.icu.text.Transliterator.getInstance("Han-Latin; Latin-ASCII")
}

// GB2312 一级汉字各拼音首字母的起始编码（I/U/V 无汉字）
private val GB2312_BOUNDARIES = intArrayOf(
    0xB0A1, 0xB0C5, 0xB2C1, 0xB4EE, 0xB6EA, 0xB7A2, 0xB8C1, 0xB9FE, 0xBBF7,
    0xBFA6, 0xC0AC, 0xC2E8, 0xC4C3, 0xC5B6, 0xC5BE, 0xC6DA, 0xC8BB, 0xC8F6,
    0xCBFA, 0xCDDA, 0xCEF4, 0xD1B9, 0xD4D1,
)
private const val GB2312_LETTERS = "ABCDEFGHJKLMNOPQRSTWXYZ"

private fun gb2312FirstLetter(c: Char): Char {
    val bytes = runCatching { c.toString().toByteArray(charset("GB2312")) }.getOrNull() ?: return '#'
    if (bytes.size != 2) return '#'
    val code = ((bytes[0].toInt() and 0xFF) shl 8) or (bytes[1].toInt() and 0xFF)
    if (code < GB2312_BOUNDARIES[0] || code > 0xD7F9) return '#'   // 二级汉字按部首排列，无法推算
    var letter = '#'
    for (i in GB2312_BOUNDARIES.indices) if (code >= GB2312_BOUNDARIES[i]) letter = GB2312_LETTERS[i]
    return letter
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
        // 组内按拼音排序：Android 的 Collator 基于 ICU，中文区域规则即拼音序
        val collator = java.text.Collator.getInstance(java.util.Locale.CHINA)
        contacts.groupBy { sectionLetterOf(it.displayName.ifBlank { it.username }) }
            .mapValues { (_, list) -> list.sortedWith(compareBy(collator) { it.displayName.ifBlank { it.username } }) }
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
                        color = VxinBrand,
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
            InitialAvatar(name = contact.displayName.ifBlank { "?" }, size = 44.dp, avatarUrl = avatarUrl)
            if (online) {
                Box(
                    Modifier.align(Alignment.BottomEnd).size(12.dp)
                        // 描边圈随主题：浅色=白、深色=卡面色，深色下不再突兀
                        .clip(CircleShape).background(MaterialTheme.colorScheme.surface).padding(2.dp)
                        .clip(CircleShape).background(VxinBrand),
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(contact.displayName.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (contact.bio.isNotBlank()) {
                Text(contact.bio, color = VxinTextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
            // 特权账户：离线时展示精确最后在线时间（后端仅对特权账户返回 lastOnlineAt）
            if (!online && contact.lastOnlineAt != null && contact.lastOnlineAt > 0) {
                Text(
                    formatLastOnline(contact.lastOnlineAt),
                    color = VxinTextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(text = { Text("设置备注") }, onClick = { onRemark(); menuOpen = false })
            DropdownMenuItem(text = { Text("加入黑名单") }, onClick = { onBlock(); menuOpen = false })
            DropdownMenuItem(text = { Text("删除好友", color = com.touliao.app.ui.theme.VxinError) }, onClick = { onDelete(); menuOpen = false })
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

// module-level 单实例：好友列表滚动时每项都会算最后在线，避免每次 new SimpleDateFormat（GC 抖动）。
// 仅 Compose 主线程调用，无并发，单实例安全。
private val lastOnlineTimeFmt = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
private val lastOnlineDateFmt = java.text.SimpleDateFormat("M月d日 HH:mm", java.util.Locale.getDefault())

/** 特权账户：格式化好友最后在线时间（Unix 秒），精确到分钟。 */
private fun formatLastOnline(epochSec: Long): String {
    if (epochSec <= 0) return ""
    val millis = epochSec * 1000
    val diff = (System.currentTimeMillis() - millis).coerceAtLeast(0)
    return when {
        diff < 60_000L -> "刚刚在线"
        diff < 3_600_000L -> "${diff / 60_000L} 分钟前在线"
        diff < 86_400_000L -> "今天 ${lastOnlineTimeFmt.format(java.util.Date(millis))}"
        diff < 172_800_000L -> "昨天 ${lastOnlineTimeFmt.format(java.util.Date(millis))}"
        else -> lastOnlineDateFmt.format(java.util.Date(millis))
    }
}
