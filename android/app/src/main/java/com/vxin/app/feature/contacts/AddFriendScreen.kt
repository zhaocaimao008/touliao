package com.vxin.app.feature.contacts

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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.SearchUser
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddFriendScreen(
    onBack: () -> Unit,
    viewModel: AddFriendViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            androidx.compose.material3.TopAppBar(
                title = { Text("添加好友") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            OutlinedTextField(
                value = state.query,
                onValueChange = viewModel::onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("手机号 / v信号 / 用户名") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { viewModel.search() }),
            )
            Spacer(Modifier.size(8.dp))
            Button(
                onClick = viewModel::search,
                enabled = state.query.isNotBlank() && !state.searching,
                colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("搜索") }

            state.message?.let {
                Spacer(Modifier.size(8.dp))
                Text(it, color = VxinGreen, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.size(8.dp))
            Box(Modifier.fillMaxSize()) {
                when {
                    state.searching -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    state.searched && state.results.isEmpty() ->
                        Text("未找到用户", color = VxinTextSecondary, modifier = Modifier.align(Alignment.TopCenter))
                    else -> LazyColumn(Modifier.fillMaxSize()) {
                        items(state.results, key = { it.id }) { user ->
                            SearchRow(user, sent = user.id in state.sentIds) { viewModel.sendRequest(user) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchRow(user: SearchUser, sent: Boolean, onAdd: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = user.username.ifBlank { "?" }, size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(user.username.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge)
            if (user.wechat_id.isNotBlank()) {
                Text("v信号: ${user.wechat_id}", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
            }
        }
        Button(
            onClick = onAdd,
            enabled = !sent,
            colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
        ) { Text(if (sent) "已发送" else "添加") }
    }
}
