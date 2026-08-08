package com.vxin.app.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.core.storage.ThemeMode

// ── 通用：设置行（标题 + 副标题 + 右侧开关） ──
@Composable
private fun ToggleRow(title: String, subtitle: String? = null, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(16.dp, 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun SectionCaption(text: String) {
    Text(text, Modifier.padding(16.dp, 16.dp, 16.dp, 4.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScaffold(title: String, onBack: () -> Unit, content: @Composable () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) { content() }
    }
}

// ── 隐私与安全 ──
@Composable
fun PrivacySettingsScreen(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    SettingsScaffold("隐私与安全", onBack) {
        if (state.loading) {
            Box(Modifier.fillMaxWidth().padding(top = 48.dp), Alignment.Center) { CircularProgressIndicator() }
            return@SettingsScaffold
        }
        val s = state.settings
        SectionCaption("添加我的方式")
        ToggleRow("通过 v信号添加", checked = s.addByVxinId) { viewModel.setAddByVxinId(it) }
        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
        ToggleRow("通过手机号添加", checked = s.addByPhone) { viewModel.setAddByPhone(it) }
        SectionCaption("好友与群")
        ToggleRow("需要验证才能添加好友", subtitle = "关闭后对方可直接添加你", checked = s.requireVerify) { viewModel.setRequireVerify(it) }
        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
        ToggleRow("不允许好友直接邀请我进群", subtitle = "开启后需你扫码/点链接自行加入", checked = s.noDirectGroupInvite) { viewModel.setNoDirectGroupInvite(it) }
        state.error?.let { Text(it, Modifier.padding(16.dp, 8.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
}

// ── 通知 ──
@Composable
fun NotificationSettingsScreen(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    // 勿扰时段编辑弹窗状态
    var showQuietDialog by remember { mutableStateOf(false) }

    SettingsScaffold("通知", onBack) {
        if (state.loading) {
            Box(Modifier.fillMaxWidth().padding(top = 48.dp), Alignment.Center) { CircularProgressIndicator() }
            return@SettingsScaffold
        }
        val s = state.settings
        ToggleRow("接收新消息通知", checked = s.messageNotify) { viewModel.setMessageNotify(it) }
        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
        ToggleRow("通知显示消息详情", subtitle = "关闭后锁屏只提示「你有一条新消息」", checked = s.detailPreview) { viewModel.setDetailPreview(it) }
        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
        ToggleRow("声音", checked = s.sound) { viewModel.setSound(it) }
        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
        ToggleRow("震动", checked = s.vibrate) { viewModel.setVibrate(it) }

        // ── 勿扰时段 ──────────────────────────────────────────────────────────
        SectionCaption("勿扰模式（仅抑制推送通知，聊天正常收消息）")
        ToggleRow(
            title = "勿扰模式",
            subtitle = if (s.quietEnabled == 1) "已开启：${s.quietStart} – ${s.quietEnd}" else "关闭",
            checked = s.quietEnabled == 1,
        ) { viewModel.setQuietEnabled(it) }
        // 时段选择行（点击弹出时间编辑弹窗）
        if (s.quietEnabled == 1) {
            HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
            Row(
                Modifier.fillMaxWidth().clickable { showQuietDialog = true }.padding(16.dp, 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text("勿扰时段", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        "${s.quietStart} – ${s.quietEnd}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Text("修改", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium)
            }
        }

        state.error?.let { Text(it, Modifier.padding(16.dp, 8.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }

    // 勿扰时段编辑弹窗
    if (showQuietDialog) {
        val s = state.settings
        QuietTimeDialog(
            initialStart = s.quietStart,
            initialEnd = s.quietEnd,
            onDismiss = { showQuietDialog = false },
            onSave = { start, end ->
                viewModel.saveQuietTime(start, end)
                showQuietDialog = false
            },
        )
    }
}

// ── 外观 ──
@Composable
fun AppearanceSettingsScreen(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    val mode by viewModel.themeMode.collectAsStateWithLifecycle()
    SettingsScaffold("外观", onBack) {
        SectionCaption("深色模式")
        ThemeRow("跟随系统", ThemeMode.SYSTEM, mode) { viewModel.setThemeMode(it) }
        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
        ThemeRow("日间模式", ThemeMode.LIGHT, mode) { viewModel.setThemeMode(it) }
        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
        ThemeRow("夜间模式", ThemeMode.DARK, mode) { viewModel.setThemeMode(it) }
    }
}

@Composable
private fun ThemeRow(label: String, value: ThemeMode, current: ThemeMode, onSelect: (ThemeMode) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onSelect(value) }.padding(16.dp, 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        if (current == value) Icon(Icons.Filled.Check, contentDescription = "已选", tint = MaterialTheme.colorScheme.primary)
    }
}

/**
 * 勿扰时段编辑弹窗。
 * 输入格式：HH:MM（24 小时制），支持跨夜（如 23:00 – 07:00）。
 * 前端只负责保存用户设定，推送抑制逻辑由后端处理。
 */
@Composable
private fun QuietTimeDialog(
    initialStart: String,
    initialEnd: String,
    onDismiss: () -> Unit,
    onSave: (start: String, end: String) -> Unit,
) {
    var startText by remember { mutableStateOf(initialStart) }
    var endText   by remember { mutableStateOf(initialEnd) }
    var error     by remember { mutableStateOf<String?>(null) }

    /** 校验 HH:MM 格式是否合法 */
    fun isValidTime(t: String): Boolean {
        val parts = t.split(":")
        if (parts.size != 2) return false
        val h = parts[0].toIntOrNull() ?: return false
        val m = parts[1].toIntOrNull() ?: return false
        return h in 0..23 && m in 0..59
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("设置勿扰时段") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "输入格式：HH:MM（24小时制）。支持跨夜，例如 23:00 – 07:00。\n仅抑制推送通知，聊天正常收消息。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = startText,
                    onValueChange = { startText = it; error = null },
                    label = { Text("开始时间（HH:MM）") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = endText,
                    onValueChange = { endText = it; error = null },
                    label = { Text("结束时间（HH:MM）") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(4.dp))
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (!isValidTime(startText)) { error = "开始时间格式错误，请输入 HH:MM"; return@TextButton }
                if (!isValidTime(endText))   { error = "结束时间格式错误，请输入 HH:MM"; return@TextButton }
                onSave(startText, endText)
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
