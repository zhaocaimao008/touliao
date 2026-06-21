package com.vxin.app.feature.contacts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.Contact
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactsScreen(
    onOpenChat: (ConversationTarget) -> Unit,
    onAddFriend: () -> Unit,
    onRequests: () -> Unit,
    onCreateGroup: () -> Unit,
    viewModel: ContactsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val openChat by viewModel.openChat.collectAsStateWithLifecycle()

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
                    else -> LazyColumn(Modifier.fillMaxSize()) {
                        items(state.contacts, key = { it.id }) { contact ->
                            ContactRow(contact) { viewModel.startPrivateChat(contact) }
                            HorizontalDivider(Modifier.padding(start = 76.dp), thickness = 0.5.dp)
                        }
                    }
                }
            }
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
        }
    }
}

@Composable
private fun ContactRow(contact: Contact, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = contact.displayName.ifBlank { "?" }, size = 48.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(contact.displayName.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (contact.bio.isNotBlank()) {
                Text(contact.bio, color = VxinTextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
