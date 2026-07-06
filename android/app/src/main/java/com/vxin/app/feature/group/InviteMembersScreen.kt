package com.vxin.app.feature.group

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.Contact
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteMembersScreen(
    onBack: () -> Unit,
    onDone: () -> Unit,
    viewModel: InviteMembersViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(state.done) { if (state.done) onDone() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("邀请成员") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                },
                actions = {
                    TextButton(
                        onClick = viewModel::invite,
                        enabled = state.selected.isNotEmpty() && !state.inviting,
                    ) { Text(if (state.selected.isEmpty()) "邀请" else "邀请(${state.selected.size})") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.candidates.isEmpty() -> Text("没有可邀请的联系人", color = VxinTextSecondary, modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(state.candidates, key = { it.id }) { contact ->
                        CandidateRow(contact, checked = contact.id in state.selected) { viewModel.toggle(contact.id) }
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
private fun CandidateRow(contact: Contact, checked: Boolean, onToggle: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (checked) Icon(Icons.Filled.CheckCircle, contentDescription = "已选", tint = VxinGreen)
        else RadioButton(selected = false, onClick = onToggle)
        Spacer(Modifier.width(8.dp))
        InitialAvatar(name = contact.displayName.ifBlank { "?" }, size = 40.dp)
        Spacer(Modifier.width(12.dp))
        Text(contact.displayName.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge)
    }
}
