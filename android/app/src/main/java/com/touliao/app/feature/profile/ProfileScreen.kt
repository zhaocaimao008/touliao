package com.touliao.app.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.ripple.rememberRipple
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.touliao.app.feature.update.UpdateCheckDialog
import com.touliao.app.feature.update.UpdateViewModel
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.components.InitialAvatar
import com.touliao.app.ui.theme.VxinBrand
import com.touliao.app.ui.theme.VxinBrandMuted

// ── Design tokens（间距/圆角/品牌色静态；明暗色走 MaterialTheme 动态主题）──

private object Tok {
    // spacing
    val XS = 4.dp;  val S = 8.dp;  val M = 12.dp
    val L = 16.dp;  val XL = 20.dp; val XXL = 24.dp
    // brand（投聊极光靛，不复制 v信绿）
    val Green   = VxinBrand
    val GreenBg = VxinBrandMuted
    val Red     = Color(0xFFFF3B30)
    // shape / size
    val cardRadius = 16.dp
    val avatarRadius = 14.dp
    val avatarSize = 66.dp
    val iconSize = 22.dp
    val rowHeight = 56.dp
    // 平板/雷电最大内容宽度（避免控件横向拉太宽）
    val maxContentWidth = 600.dp
}

// ── Shared components（动态主题色，Light/Dark 自动切换）────────────────────────

@Composable
private fun VxCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Tok.cardRadius))
            .background(MaterialTheme.colorScheme.surface)
            .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Tok.cardRadius)),
        content = content,
    )
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = Tok.XL, top = Tok.XL, bottom = Tok.S),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
    )
}

@Composable
private fun RowDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = Tok.L + Tok.XXL + Tok.M),
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    trailing: String? = null,
    iconColor: Color? = null,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(Tok.rowHeight)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = rememberRipple(bounded = true),
                onClick = onClick,
            )
            .padding(horizontal = Tok.L),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(Tok.XXL), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = title, tint = iconColor ?: MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(Tok.iconSize))
        }
        Spacer(Modifier.width(Tok.M))
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            fontSize = 16.5.sp,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (trailing != null) {
            Text(
                text = trailing,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(end = Tok.S),
            )
        }
        Icon(
            TouliaoIcons.ChevronRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.size(16.dp),
        )
    }
}

// ── ProfileScreen ──────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    onAddAccount: () -> Unit = {},
    onOpenMyQr: () -> Unit = {},
    onOpenCallHistory: () -> Unit = {},
    onOpenWallet: () -> Unit = {},
    onOpenSessions: () -> Unit = {},
    onOpenInviteFriend: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenProfileEdit: () -> Unit = {},
    viewModel: ProfileViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val accounts by viewModel.accounts.collectAsStateWithLifecycle()
    val user = state.user
    LaunchedEffect(Unit) { viewModel.refreshAccounts() }
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
        viewModel.refreshUser()
        onPauseOrDispose { }
    }

    // 检查更新（投聊保留功能）：启动静默检查，有新版自动弹窗
    val updateViewModel: UpdateViewModel = hiltViewModel()
    val updateState by updateViewModel.uiState.collectAsStateWithLifecycle()
    val silentResult by updateViewModel.silentResult.collectAsStateWithLifecycle()
    var showUpdateDialog by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { updateViewModel.silentCheck() }
    LaunchedEffect(silentResult) {
        if (silentResult is com.touliao.app.feature.update.SilentCheckResult.HasUpdate) {
            showUpdateDialog = true; updateViewModel.openDialog()
        }
    }

    var showChangePhoneDialog by remember { mutableStateOf(false) }
    var showChangePasswordDialog by remember { mutableStateOf(false) }
    var showDeleteAccountDialog by remember { mutableStateOf(false) }
    var showLogoutDialog by remember { mutableStateOf(false) }
    var showSwitchAccount by remember { mutableStateOf(false) }
    var versionTaps by remember { mutableStateOf(0) }
    var showBuild by remember { mutableStateOf(false) }

    fun maskedPhone(phone: String?): String {
        if (phone.isNullOrBlank()) return "未绑定"
        return if (phone.length >= 7) "${phone.take(3)}****${phone.takeLast(4)}" else phone
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {},   // 无 TopBar，对齐母版
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier
                    .widthIn(max = Tok.maxContentWidth)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {

                // ── 1. 用户信息卡片（点击进资料编辑；二维码独立点击）───────
                Box(Modifier.padding(horizontal = Tok.L, vertical = Tok.XXL)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(Tok.cardRadius))
                            .background(MaterialTheme.colorScheme.surface)
                            .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Tok.cardRadius))
                            .clickable(onClick = onOpenProfileEdit)
                            .padding(Tok.L),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val avatarUrl = viewModel.resolveAvatarUrl(user?.avatar)
                        if (!user?.avatar.isNullOrBlank()) {
                            AsyncImage(
                                model = avatarUrl,
                                contentDescription = "头像",
                                modifier = Modifier
                                    .size(Tok.avatarSize)
                                    .clip(RoundedCornerShape(Tok.avatarRadius)),
                            )
                        } else {
                            InitialAvatar(
                                name = user?.username ?: "?",
                                size = Tok.avatarSize,
                            )
                        }
                        if (state.uploadingAvatar) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Tok.Green)
                        }
                        Spacer(Modifier.width(Tok.M))
                        Column(Modifier.weight(1f)) {
                            Text(
                                user?.username?.ifBlank { "未设置昵称" } ?: "未登录",
                                fontSize = 21.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            user?.wechat_id?.takeIf { it.isNotBlank() }?.let {
                                Spacer(Modifier.height(Tok.XS))
                                Text("投聊号：$it", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                            }
                        }
                        IconButton(
                            onClick = onOpenMyQr,
                            modifier = Modifier.testTag("profile-my-qr"),
                        ) {
                            Icon(TouliaoIcons.QrCode, contentDescription = "我的二维码", tint = Tok.Green, modifier = Modifier.size(22.dp))
                        }
                        Icon(TouliaoIcons.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
                    }
                }

                // ── 2. 账户与服务 ──────────────────────────────────────────
                SectionHeader("账户与服务")
                VxCard(Modifier.padding(horizontal = Tok.L).padding(bottom = Tok.M)) {
                    SettingsRow(TouliaoIcons.Phone, "手机号", trailing = maskedPhone(user?.phone), onClick = { showChangePhoneDialog = true })
                    RowDivider()
                    SettingsRow(TouliaoIcons.Wallet, "我的钱包", onClick = onOpenWallet, modifier = Modifier.testTag("profile-wallet"))
                    RowDivider()
                    SettingsRow(TouliaoIcons.PhoneCall, "通话记录", onClick = onOpenCallHistory, modifier = Modifier.testTag("profile-call-history"))
                    RowDivider()
                    SettingsRow(TouliaoIcons.Devices, "登录设备管理", onClick = onOpenSessions, modifier = Modifier.testTag("profile-sessions"))
                    RowDivider()
                    SettingsRow(TouliaoIcons.Lock, "修改密码", onClick = { showChangePasswordDialog = true })
                }

                // ── 3. 设置（子项收拢进独立设置页）─────────────────────────
                VxCard(Modifier.padding(horizontal = Tok.L).padding(top = Tok.M).padding(bottom = Tok.M)) {
                    SettingsRow(TouliaoIcons.Gear, "设置", onClick = onOpenSettings)
                }

                // ── 4. 其他 ────────────────────────────────────────────────
                SectionHeader("其他")
                VxCard(Modifier.padding(horizontal = Tok.L).padding(bottom = Tok.M)) {
                    SettingsRow(TouliaoIcons.UserPlus, "邀请好友", onClick = onOpenInviteFriend)
                    RowDivider()
                    val switchTrailing = "${user?.username?.ifBlank { "当前" } ?: "当前"} · 当前"
                    SettingsRow(TouliaoIcons.Users, "切换账号", trailing = switchTrailing, onClick = { showSwitchAccount = true })
                }

                // ── 5. 退出登录 ───────────────────────────────────────────
                VxCard(Modifier.padding(horizontal = Tok.L).padding(bottom = Tok.M)) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(54.dp)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = rememberRipple(bounded = true),
                            ) { showLogoutDialog = true },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("退出登录", color = Tok.Red, fontSize = 16.5.sp)
                    }
                }

                // ── 5b. 注销账号（刻意做得比退出登录更低调，与 Web 一致）──────
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = rememberRipple(bounded = true),
                        ) { showDeleteAccountDialog = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("注销账号", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp,
                        textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                        modifier = Modifier.padding(vertical = Tok.M))
                }

                // ── 6. 版本号（5 连点显示构建号）────────────────────────────
                Text(
                    text = if (showBuild)
                        "投聊 ${com.touliao.app.BuildConfig.VERSION_NAME} (${com.touliao.app.BuildConfig.VERSION_CODE})"
                    else
                        "投聊 ${com.touliao.app.BuildConfig.VERSION_NAME}",
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = Tok.XXL)
                        .clickable {
                            versionTaps++
                            if (versionTaps >= 5) showBuild = true
                        },
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }

    // ── Dialogs ───────────────────────────────────────────────────────────────

    if (showUpdateDialog) {
        UpdateCheckDialog(viewModel = updateViewModel, onDismiss = { showUpdateDialog = false })
    }

    if (showChangePhoneDialog) {
        ChangePhoneDialog(
            currentPhone = user?.phone.orEmpty(),
            changing = state.changingPhone,
            onConfirm = { newPhone, password -> viewModel.changePhone(newPhone, password); showChangePhoneDialog = false },
            onDismiss = { showChangePhoneDialog = false },
        )
    }

    if (showChangePasswordDialog) {
        ChangePasswordDialog(
            changing = state.changingPassword,
            // 与 ChangePhoneDialog 同一套约定：确认即提交并关闭弹窗，不等待请求结果
            // （这个页面目前没有消费 state.message 的 Snackbar/Toast 承载，换绑手机号也是同样处理）。
            onConfirm = { old, new -> viewModel.changePassword(old, new); showChangePasswordDialog = false },
            onDismiss = { showChangePasswordDialog = false },
        )
    }

    if (showDeleteAccountDialog) {
        DeleteAccountDialog(
            deleting = state.deletingAccount,
            onConfirm = { password -> viewModel.deleteAccount(password) },
            onDismiss = { showDeleteAccountDialog = false },
        )
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("退出登录") },
            text = { Text("确认退出当前账号？") },
            confirmButton = {
                TextButton(onClick = { showLogoutDialog = false; viewModel.logout() }) {
                    Text("退出", color = Tok.Red)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) { Text("取消") }
            },
        )
    }

    if (showSwitchAccount) {
        AccountSwitchSheet(
            accounts = accounts,
            activeId = viewModel.activeAccountId,
            onSwitch = { id -> viewModel.switchAccount(id); showSwitchAccount = false },
            onRemove = { id -> viewModel.removeAccount(id) },
            onAddAccount = { showSwitchAccount = false; onAddAccount() },
            onDismiss = { showSwitchAccount = false },
        )
    }
}

// ── 切换账号底部弹层 ────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountSwitchSheet(
    accounts: List<com.touliao.app.data.model.Account>,
    activeId: String?,
    onSwitch: (String) -> Unit,
    onRemove: (String) -> Unit,
    onAddAccount: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.surface) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = Tok.maxContentWidth).fillMaxWidth()) {
                Text(
                    "切换账号",
                    Modifier.fillMaxWidth().padding(horizontal = Tok.L, vertical = Tok.M),
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
                accounts.forEach { acc ->
                    val isCurrent = acc.id == activeId
                    Row(
                        Modifier.fillMaxWidth()
                            .height(Tok.rowHeight)
                            .clickable(enabled = !isCurrent) { onSwitch(acc.id) }
                            .padding(horizontal = Tok.L),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        InitialAvatar(name = acc.username.ifBlank { "?" }, size = 40.dp)
                        Spacer(Modifier.width(Tok.M))
                        Column(Modifier.weight(1f)) {
                            Text(
                                acc.username.ifBlank { "未命名" },
                                fontSize = 15.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1,
                            )
                        }
                        if (isCurrent) {
                            Text(
                                "当前",
                                fontSize = 13.sp,
                                color = Tok.Green,
                                modifier = Modifier
                                    .background(Tok.GreenBg, RoundedCornerShape(50))
                                    .padding(horizontal = Tok.S, vertical = Tok.XS),
                            )
                        } else {
                            TextButton(onClick = { onRemove(acc.id) }) {
                                Text("移除", color = Tok.Red, fontSize = 14.sp)
                            }
                        }
                    }
                    HorizontalDivider(Modifier.padding(start = Tok.L + 40.dp + Tok.M), color = MaterialTheme.colorScheme.outlineVariant, thickness = 0.5.dp)
                }
                Row(
                    Modifier.fillMaxWidth()
                        .height(Tok.rowHeight)
                        .clickable { onAddAccount() }
                        .padding(horizontal = Tok.L),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                        Icon(TouliaoIcons.Add, contentDescription = null, tint = Tok.Green)
                    }
                    Spacer(Modifier.width(Tok.M))
                    Text("添加账号", fontSize = 15.sp, color = Tok.Green)
                }
                Spacer(Modifier.height(Tok.XXL))
            }
        }
    }
}

// ── 换绑手机号弹窗（投聊保留功能）────────────────────────────────────────────

@Composable
fun ChangePhoneDialog(
    currentPhone: String,
    changing: Boolean,
    onConfirm: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var newPhone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    val valid = newPhone.trim().length >= 6 && password.isNotBlank()

    AlertDialog(
        onDismissRequest = { if (!changing) onDismiss() },
        title = { Text("换绑手机号") },
        text = {
            Column {
                if (currentPhone.isNotBlank()) {
                    Text("当前手机号：$currentPhone", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.size(Tok.S))
                }
                OutlinedTextField(
                    value = newPhone,
                    onValueChange = { newPhone = it.filter { c -> c.isDigit() || c == '+' }.take(16) },
                    label = { Text("新手机号") }, singleLine = true,
                    enabled = !changing, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.size(Tok.S))
                OutlinedTextField(
                    value = password, onValueChange = { password = it },
                    label = { Text("登录密码") }, singleLine = true, enabled = !changing,
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        TextButton(onClick = { showPassword = !showPassword }) {
                            Text(if (showPassword) "隐藏" else "显示", style = MaterialTheme.typography.bodySmall)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(newPhone.trim(), password) }, enabled = valid && !changing) {
                if (changing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text("确认换绑", color = Tok.Green)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !changing) { Text("取消") } },
    )
}

// ── 修改密码弹窗 ─────────────────────────────────────────────────────────
@Composable
fun ChangePasswordDialog(
    changing: Boolean,
    onConfirm: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var oldPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    val mismatch = confirmPassword.isNotEmpty() && newPassword != confirmPassword
    val valid = oldPassword.isNotBlank() && newPassword.length >= 6 && newPassword == confirmPassword

    AlertDialog(
        onDismissRequest = { if (!changing) onDismiss() },
        title = { Text("修改密码") },
        text = {
            Column {
                OutlinedTextField(
                    value = oldPassword, onValueChange = { oldPassword = it },
                    label = { Text("原密码") }, singleLine = true, enabled = !changing,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.size(Tok.S))
                OutlinedTextField(
                    value = newPassword, onValueChange = { newPassword = it },
                    label = { Text("新密码（至少 6 位）") }, singleLine = true, enabled = !changing,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.size(Tok.S))
                OutlinedTextField(
                    value = confirmPassword, onValueChange = { confirmPassword = it },
                    label = { Text("确认新密码") }, singleLine = true, enabled = !changing,
                    isError = mismatch,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (mismatch) {
                    Text("两次输入的新密码不一致", color = Tok.Red, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(oldPassword, newPassword) }, enabled = valid && !changing) {
                if (changing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text("确认修改", color = Tok.Green)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !changing) { Text("取消") } },
    )
}

// ── 注销账号弹窗 ─────────────────────────────────────────────────────────
@Composable
fun DeleteAccountDialog(
    deleting: Boolean,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var password by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = { if (!deleting) onDismiss() },
        title = { Text("注销账号") },
        text = {
            Column {
                Text(
                    "注销后账号将无法登录，聊天记录/好友/群组/钱包余额等数据不可找回。请先确保钱包余额已清零。",
                    color = Tok.Red, style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.size(Tok.S))
                OutlinedTextField(
                    value = password, onValueChange = { password = it },
                    label = { Text("登录密码（用于验证身份）") }, singleLine = true, enabled = !deleting,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(password) }, enabled = password.isNotBlank() && !deleting) {
                if (deleting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text("确认注销", color = Tok.Red)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !deleting) { Text("取消") } },
    )
}
