package com.touliao.app.feature.settings

import android.content.Context
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
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.storage.MsgCacheStore
import com.touliao.app.feature.update.UpdateCheckDialog
import com.touliao.app.feature.update.UpdateViewModel
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.theme.VxinBrand
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import java.io.File

data class SettingsHomeUiState(
    val cacheBytes: Long = 0L,
    val clearing: Boolean = false,
)

@HiltViewModel
class SettingsHomeViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val msgCacheStore: MsgCacheStore,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SettingsHomeUiState())
    val uiState: StateFlow<SettingsHomeUiState> = _uiState.asStateFlow()

    init { refreshCacheSize() }

    private fun dirSize(f: File): Long =
        if (!f.exists()) 0L
        else if (f.isDirectory) (f.listFiles()?.sumOf { dirSize(it) } ?: 0L)
        else f.length()

    fun refreshCacheSize() {
        viewModelScope.launch(Dispatchers.IO) {
            val bytes = dirSize(context.cacheDir)
            _uiState.update { it.copy(cacheBytes = bytes) }
        }
    }

    /** 真实清缓存：删除 App 缓存目录（含图片/媒体磁盘缓存）+ 本地离线消息缓存（安全可清，服务端为真相源）。 */
    fun clearCache() {
        viewModelScope.launch(Dispatchers.IO) {
            _uiState.update { it.copy(clearing = true) }
            runCatching {
                context.cacheDir.listFiles()?.forEach { it.deleteRecursively() }
                msgCacheStore.clear()
            }
            val bytes = dirSize(context.cacheDir)
            _uiState.update { it.copy(clearing = false, cacheBytes = bytes) }
        }
    }
}

private fun formatBytes(bytes: Long): String {
    val mb = bytes / 1024.0 / 1024.0
    return if (mb < 0.1) "0 MB" else "%.1f MB".format(mb)
}

/** 投聊设置首页：消息通知/隐私与安全/外观/登录设备管理 + 清除缓存/检查更新/关于 投聊。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsHomeScreen(
    onBack: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenPrivacy: () -> Unit,
    onOpenAppearance: () -> Unit,
    onOpenSessions: () -> Unit,
    viewModel: SettingsHomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showClearConfirm by remember { mutableStateOf(false) }
    var showAbout by remember { mutableStateOf(false) }
    var showUpdateDialog by remember { mutableStateOf(false) }
    val updateViewModel: UpdateViewModel = hiltViewModel()
    val updateState by updateViewModel.uiState.collectAsStateWithLifecycle()
    val silentResult by updateViewModel.silentResult.collectAsStateWithLifecycle()
    val hasUpdate = silentResult is com.touliao.app.feature.update.SilentCheckResult.HasUpdate
    // 动态背景：浅色 #F5F5F7 / 深色随主题
    val bg = MaterialTheme.colorScheme.background

    Scaffold(
        containerColor = bg,
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 600.dp).fillMaxWidth().verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(16.dp))
                SettingsGroupCard(Modifier.padding(horizontal = 16.dp)) {
                    HubRow(TouliaoIcons.Bell, "消息通知", onClick = onOpenNotifications)
                    HubDivider()
                    HubRow(TouliaoIcons.Shield, "隐私与安全", onClick = onOpenPrivacy)
                    HubDivider()
                    HubRow(TouliaoIcons.Palette, "外观", onClick = onOpenAppearance)
                    HubDivider()
                    HubRow(TouliaoIcons.Devices, "登录设备管理", onClick = onOpenSessions)
                }
                Spacer(Modifier.height(12.dp))
                SettingsGroupCard(Modifier.padding(horizontal = 16.dp)) {
                    val clearingIndicator: (@Composable () -> Unit)? =
                        if (state.clearing) ({ CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = VxinBrand) }) else null
                    HubRow(
                        TouliaoIcons.Trash, "清除缓存",
                        trailing = if (state.clearing) null else formatBytes(state.cacheBytes),
                        trailingContent = clearingIndicator,
                        onClick = { showClearConfirm = true },
                    )
                    HubDivider()
                    HubRow(
                        TouliaoIcons.Info, "检查更新",
                        trailing = if (hasUpdate) "新版本可用" else null,
                        trailingColor = if (hasUpdate) VxinBrand else null,
                        onClick = {
                            updateViewModel.openDialog()
                            showUpdateDialog = true
                        },
                    )
                    HubDivider()
                    HubRow(TouliaoIcons.Info, "关于 投聊", trailing = com.touliao.app.BuildConfig.VERSION_NAME, onClick = { showAbout = true })
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    if (showClearConfirm) {
        AlertDialog(
            onDismissRequest = { showClearConfirm = false },
            title = { Text("清除缓存") },
            text = { Text("将清除本地图片缓存与离线消息缓存，不影响服务器上的聊天记录。") },
            confirmButton = { TextButton(onClick = { viewModel.clearCache(); showClearConfirm = false }) { Text("清除", color = Color(0xFFFF3B30)) } },
            dismissButton = { TextButton(onClick = { showClearConfirm = false }) { Text("取消") } },
        )
    }
    if (showAbout) {
        AlertDialog(
            onDismissRequest = { showAbout = false },
            title = { Text("关于 投聊") },
            text = { Text("版本 ${com.touliao.app.BuildConfig.VERSION_NAME} (${com.touliao.app.BuildConfig.VERSION_CODE})") },
            confirmButton = { TextButton(onClick = { showAbout = false }) { Text("确定") } },
        )
    }
    if (showUpdateDialog) {
        UpdateCheckDialog(
            viewModel = updateViewModel,
            onDismiss = { showUpdateDialog = false },
        )
    }
}

@Composable
private fun SettingsGroupCard(modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
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
private fun HubDivider() {
    HorizontalDivider(modifier = Modifier.padding(start = 52.dp), thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun HubRow(
    icon: ImageVector,
    title: String,
    trailing: String? = null,
    trailingColor: Color? = null,
    trailingContent: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = rememberRipple(bounded = true),
                onClick = onClick,
            )
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(title, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface, fontSize = com.touliao.app.ui.theme.VxinTextSize.md)
        if (trailingContent != null) {
            trailingContent()
            Spacer(Modifier.width(8.dp))
        } else if (trailing != null) {
            Text(trailing, color = trailingColor ?: MaterialTheme.colorScheme.onSurfaceVariant, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 8.dp))
        }
        Icon(TouliaoIcons.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
    }
}
