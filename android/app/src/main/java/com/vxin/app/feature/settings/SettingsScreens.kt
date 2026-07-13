package com.vxin.app.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
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
        state.error?.let { Text(it, Modifier.padding(16.dp, 8.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
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
