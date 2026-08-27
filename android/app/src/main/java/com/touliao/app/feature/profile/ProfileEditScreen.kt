package com.touliao.app.feature.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.ripple.rememberRipple
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import coil.compose.AsyncImage
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.components.InitialAvatar
import com.touliao.app.ui.theme.VxinBrand

/**
 * 个人资料页（投聊版）：真实字段绑定（User 模型 username/phone/avatar/bio/wechat_id）。
 * 结构对齐母版：头像/昵称/投聊号/个性签名 + 手机号换绑/我的二维码。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileEditScreen(
    onBack: () -> Unit,
    onOpenMyQr: () -> Unit = {},
    viewModel: ProfileViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val user = state.user
    var editingField by remember { mutableStateOf<EditField?>(null) }
    var showChangePhone by remember { mutableStateOf(false) }

    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { viewModel.uploadAvatar(it) }
    }

    LaunchedEffect(state.message) {
        if (state.message != null) {
            kotlinx.coroutines.delay(1800)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("个人资料") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(16.dp))
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                    Column(Modifier.widthIn(max = 600.dp).fillMaxWidth()) {
                        EditGroupCard(Modifier.padding(horizontal = 16.dp)) {
                            EditRow(
                                label = "头像",
                                onClick = { avatarPicker.launch("image/*") },
                                trailingContent = {
                                    Box(contentAlignment = Alignment.Center) {
                                        val avatarUrl = viewModel.resolveAvatarUrl(user?.avatar)
                                        if (!user?.avatar.isNullOrBlank()) {
                                            AsyncImage(model = avatarUrl, contentDescription = "头像", modifier = Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)))
                                        } else {
                                            InitialAvatar(name = user?.username ?: "?", size = 40.dp)
                                        }
                                        if (state.uploadingAvatar) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                                    }
                                },
                            )
                            EditDivider()
                            EditRow(label = "昵称", value = user?.username?.ifBlank { "未设置" } ?: "", onClick = { editingField = EditField.NICKNAME })
                            EditDivider()
                            EditRow(label = "投聊号", value = user?.wechat_id?.ifBlank { "-" } ?: "-", clickable = false)
                            EditDivider()
                            EditRow(label = "个性签名", value = user?.bio?.ifBlank { "未设置" } ?: "未设置", onClick = { editingField = EditField.BIO })
                        }
                        Spacer(Modifier.height(12.dp))
                        EditGroupCard(Modifier.padding(horizontal = 16.dp)) {
                            EditRow(
                                label = "手机号",
                                value = maskedPhone(user?.phone),
                                onClick = { showChangePhone = true },
                            )
                            EditDivider()
                            EditRow(label = "我的二维码", onClick = onOpenMyQr, trailingContent = {
                                Icon(TouliaoIcons.QrCode, contentDescription = null, tint = VxinBrand, modifier = Modifier.size(20.dp))
                            })
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
            state.message?.let {
                Text(
                    it,
                    color = Color.White,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 24.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(Color(0xCC000000))
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
    }

    editingField?.let { field ->
        EditTextDialog(
            title = if (field == EditField.NICKNAME) "修改昵称" else "修改个性签名",
            initial = if (field == EditField.NICKNAME) user?.username.orEmpty() else user?.bio.orEmpty(),
            saving = state.saving,
            onConfirm = { newValue ->
                val username = if (field == EditField.NICKNAME) newValue else user?.username.orEmpty()
                val bio = if (field == EditField.BIO) newValue else user?.bio.orEmpty()
                viewModel.saveProfile(username, bio)
                editingField = null
            },
            onDismiss = { editingField = null },
        )
    }

    if (showChangePhone) {
        ChangePhoneDialog(
            currentPhone = user?.phone.orEmpty(),
            changing = state.changingPhone,
            onConfirm = { newPhone, password -> viewModel.changePhone(newPhone, password); showChangePhone = false },
            onDismiss = { showChangePhone = false },
        )
    }
}

private enum class EditField { NICKNAME, BIO }

private fun maskedPhone(phone: String?): String {
    if (phone.isNullOrBlank()) return "未绑定"
    return if (phone.length >= 7) "${phone.take(3)}****${phone.takeLast(4)}" else phone
}

@Composable
private fun EditGroupCard(modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(16.dp)),
        content = content,
    )
}

@Composable
private fun EditDivider() {
    HorizontalDivider(modifier = Modifier.padding(start = 16.dp), thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun EditRow(
    label: String,
    value: String? = null,
    clickable: Boolean = true,
    onClick: () -> Unit = {},
    trailingContent: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .then(
                if (clickable) Modifier.clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = rememberRipple(bounded = true),
                    onClick = onClick,
                ) else Modifier
            )
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurface, fontSize = com.touliao.app.ui.theme.VxinTextSize.md)
        Spacer(Modifier.weight(1f))
        if (trailingContent != null) {
            trailingContent()
        } else if (value != null) {
            Text(value, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (clickable) {
            Spacer(Modifier.width(8.dp))
            Icon(TouliaoIcons.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun EditTextDialog(
    title: String,
    initial: String,
    saving: Boolean,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                enabled = !saving,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(text.trim()) }, enabled = !saving && text.isNotBlank()) {
                if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("保存", color = VxinBrand)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("取消") } },
    )
}
