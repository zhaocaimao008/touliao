package com.vxin.app.feature.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    onAddAccount: () -> Unit = {},
    onOpenMyQr: () -> Unit = {},
    viewModel: ProfileViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val accounts by viewModel.accounts.collectAsStateWithLifecycle()
    val user = state.user
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refreshAccounts() }

    var username by remember(user?.id) { mutableStateOf(user?.username ?: "") }
    var bio by remember(user?.id) { mutableStateOf(user?.bio ?: "") }
    var showPwdDialog by remember { mutableStateOf(false) }
    var inviteCopied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current

    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.uploadAvatar(it) }
    }

    Scaffold(topBar = { TopAppBar(title = { Text("我") }) }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 个人信息卡片（微信风格：头像左 + 昵称/v信号右）
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    val avatarUrl = viewModel.resolveAvatarUrl(user?.avatar)
                    if (!user?.avatar.isNullOrBlank()) {
                        AsyncImage(
                            model = avatarUrl,
                            contentDescription = "头像",
                            modifier = Modifier.size(64.dp).clip(RoundedCornerShape(10.dp)).clickable { avatarPicker.launch("image/*") },
                        )
                    } else {
                        Box(Modifier.clickable { avatarPicker.launch("image/*") }) {
                            InitialAvatar(name = user?.username ?: "?", size = 64.dp)
                        }
                    }
                    if (state.uploadingAvatar) CircularProgressIndicator(Modifier.size(24.dp))
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        user?.username?.ifBlank { "未设置昵称" } ?: "未登录",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.size(4.dp))
                    user?.wechat_id?.takeIf { it.isNotBlank() }?.let {
                        Text("v信号: $it", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                    user?.phone?.takeIf { it.isNotBlank() }?.let {
                        Text("手机号: $it", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                }
                // 我的二维码入口（对齐微信：个人卡片右侧二维码图标）
                IconButton(onClick = onOpenMyQr, modifier = Modifier.testTag("profile-my-qr")) {
                    Text("▦", style = MaterialTheme.typography.titleLarge, color = VxinTextSecondary)
                }
                Text("›", color = VxinTextSecondary)
            }

            Spacer(Modifier.size(24.dp))

            OutlinedTextField(
                value = username, onValueChange = { username = it },
                label = { Text("昵称") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.size(12.dp))
            OutlinedTextField(
                value = bio, onValueChange = { bio = it },
                label = { Text("个性签名") }, modifier = Modifier.fillMaxWidth(), minLines = 2,
            )
            Spacer(Modifier.size(12.dp))
            Button(
                onClick = { viewModel.saveProfile(username, bio) },
                enabled = !state.saving && username.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
                modifier = Modifier.fillMaxWidth(),
            ) { if (state.saving) CircularProgressIndicator(Modifier.size(20.dp), color = androidx.compose.ui.graphics.Color.White, strokeWidth = 2.dp) else Text("保存资料") }

            state.message?.let {
                Spacer(Modifier.size(8.dp))
                Text(it, color = VxinGreen, style = MaterialTheme.typography.bodySmall)
            }

            // ── 邀请好友（专属邀请码 + 裂变战绩）──
            state.invite?.let { inv ->
                Spacer(Modifier.size(24.dp))
                HorizontalDivider()
                Text("邀请好友", Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp), color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("我的邀请码：${inv.code.ifBlank { "—" }}", color = VxinGreen, style = MaterialTheme.typography.bodyLarge)
                        Text("已成功邀请 ${inv.invitedCount} 人", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                    TextButton(
                        onClick = {
                            if (inv.code.isNotBlank()) { clipboard.setText(AnnotatedString(inv.code)); inviteCopied = true }
                        },
                    ) { Text(if (inviteCopied) "已复制" else "复制", color = VxinGreen) }
                }
            }

            Spacer(Modifier.size(24.dp))
            HorizontalDivider()

            // ── 账号切换 ──
            Text("账号", Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp), color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
            accounts.forEach { acc ->
                val isActive = acc.id == viewModel.activeAccountId
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = !isActive) { viewModel.switchAccount(acc.id) }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    InitialAvatar(name = acc.username.ifBlank { "?" }, size = 36.dp, avatarUrl = viewModel.resolveAvatarUrl(acc.avatar))
                    Spacer(Modifier.size(10.dp))
                    Text(acc.username.ifBlank { "未命名" }, Modifier.weight(1f))
                    if (isActive) Text("当前", color = VxinGreen, style = MaterialTheme.typography.bodySmall)
                    else TextButton(onClick = { viewModel.removeAccount(acc.id) }) { Text("移除", color = androidx.compose.ui.graphics.Color(0xFFFA5151)) }
                }
            }
            OutlinedButton(onClick = onAddAccount, modifier = Modifier.fillMaxWidth()) { Text("添加账号") }

            Spacer(Modifier.size(12.dp))
            HorizontalDivider()
            Spacer(Modifier.size(12.dp))

            // 朋友圈 / 收藏 已是底部 Tab，移除「我」页内重复入口（四端一致）
            OutlinedButton(onClick = { showPwdDialog = true }, modifier = Modifier.fillMaxWidth()) { Text("修改密码") }
            Spacer(Modifier.size(12.dp))
            Button(
                onClick = viewModel::logout,
                colors = ButtonDefaults.buttonColors(containerColor = androidx.compose.ui.graphics.Color(0xFFFA5151)),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("退出登录") }
        }
    }

    if (showPwdDialog) {
        ChangePasswordDialog(
            changing = state.changingPassword,
            onConfirm = { old, new -> viewModel.changePassword(old, new) { ok -> if (ok) showPwdDialog = false } },
            onDismiss = { showPwdDialog = false },
        )
    }
}

@Composable
private fun ChangePasswordDialog(changing: Boolean, onConfirm: (String, String) -> Unit, onDismiss: () -> Unit) {
    var old by remember { mutableStateOf("") }
    var new1 by remember { mutableStateOf("") }
    var new2 by remember { mutableStateOf("") }
    var localErr by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("修改密码") },
        text = {
            Column {
                OutlinedTextField(old, { old = it }, label = { Text("当前密码") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(new1, { new1 = it }, label = { Text("新密码（≥6位）") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(new2, { new2 = it }, label = { Text("确认新密码") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                localErr?.let { Text(it, color = androidx.compose.ui.graphics.Color(0xFFFA5151), style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    localErr = when {
                        old.isBlank() || new1.isBlank() -> "请填写完整"
                        new1.length < 6 -> "新密码至少6位"
                        new1 != new2 -> "两次新密码不一致"
                        else -> null
                    }
                    if (localErr == null) onConfirm(old, new1)
                },
                enabled = !changing,
            ) { Text("确定") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
