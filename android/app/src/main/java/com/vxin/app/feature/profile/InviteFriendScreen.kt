package com.touliao.app.feature.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.touliao.app.ui.theme.VxinTextSecondary

/** 邀请好友页（投聊版）：邀请码卡片 + 复制 + 已邀请战绩 + 邀请好友列表。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteFriendScreen(
    onBack: () -> Unit,
    viewModel: ProfileViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val invite = state.invite
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current

    LaunchedEffect(Unit) { viewModel.loadInvite() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("邀请好友") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            if (invite == null) {
                Box(Modifier.fillMaxWidth().padding(top = 64.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                Spacer(Modifier.height(24.dp))
                // 邀请码卡片
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp)) {
                        Text("我的邀请码", fontSize = 13.sp, color = VxinTextSecondary)
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                invite.code.ifBlank { "—" },
                                fontSize = 28.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.weight(1f),
                            )
                            Button(
                                onClick = {
                                    if (invite.code.isNotBlank()) {
                                        clipboard.setText(AnnotatedString(invite.code))
                                        copied = true
                                    }
                                },
                                enabled = invite.code.isNotBlank(),
                                colors = ButtonDefaults.buttonColors(containerColor = com.touliao.app.ui.theme.VxinBrand),
                            ) {
                                Text(if (copied) "已复制" else "复制邀请码")
                            }
                        }
                        Spacer(Modifier.height(4.dp))
                        Text("已成功邀请 ${invite.invitedCount} 位好友", fontSize = 13.sp, color = VxinTextSecondary)
                    }
                }

                if (invite.invitees.isNotEmpty()) {
                    Spacer(Modifier.height(24.dp))
                    Text("邀请的好友", fontSize = 13.sp, color = VxinTextSecondary)
                    Spacer(Modifier.height(8.dp))
                    invite.invitees.take(20).forEach { u ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            com.touliao.app.ui.components.InitialAvatar(
                                name = u.username.ifBlank { "?" },
                                size = 36.dp,
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(u.username.ifBlank { "未命名" }, fontSize = 15.sp)
                        }
                        HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
                Spacer(Modifier.height(32.dp))
            }
        }
    }
}
