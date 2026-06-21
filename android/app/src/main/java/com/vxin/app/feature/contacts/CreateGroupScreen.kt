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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.Contact
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateGroupScreen(
    onBack: () -> Unit,
    onCreated: (ConversationTarget) -> Unit,
    viewModel: CreateGroupViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val created by viewModel.created.collectAsStateWithLifecycle()

    LaunchedEffect(created) {
        created?.let { onCreated(it); viewModel.consumeCreated() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("发起群聊") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    TextButton(onClick = viewModel::create, enabled = state.canCreate) {
                        Text(if (state.selected.isEmpty()) "创建" else "创建(${state.selected.size})")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = state.name,
                onValueChange = viewModel::onNameChange,
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                label = { Text("群名称（留空自动生成）") },
                singleLine = true,
            )
            Box(Modifier.fillMaxSize()) {
                when {
                    state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    state.contacts.isEmpty() -> Text("还没有联系人", color = VxinTextSecondary, modifier = Modifier.align(Alignment.Center))
                    else -> LazyColumn(Modifier.fillMaxSize()) {
                        items(state.contacts, key = { it.id }) { contact ->
                            SelectableContactRow(
                                contact = contact,
                                checked = contact.id in state.selected,
                                onToggle = { viewModel.toggle(contact.id) },
                            )
                        }
                    }
                }
                if (state.creating) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                }
            }
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(12.dp))
            }
        }
    }
}

@Composable
private fun SelectableContactRow(contact: Contact, checked: Boolean, onToggle: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (checked) {
            Icon(Icons.Filled.CheckCircle, contentDescription = "已选", tint = VxinGreen)
        } else {
            RadioButton(selected = false, onClick = onToggle)
        }
        Spacer(Modifier.width(8.dp))
        InitialAvatar(name = contact.displayName.ifBlank { "?" }, size = 40.dp)
        Spacer(Modifier.width(12.dp))
        Text(contact.displayName.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge)
    }
}
