package com.vxin.app.feature.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.vxin.app.ui.theme.VxinGreen

/**
 * 更新流程弹窗。传入 UpdateViewModel 由外层 ProfileScreen 持有。
 * 根据 [UpdateUiState] 渲染不同状态。
 */
@Composable
fun UpdateCheckDialog(
    viewModel: UpdateViewModel = hiltViewModel(),
    onDismiss: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()

    when (val s = state) {
        is UpdateUiState.Idle -> {
            // 不显示任何内容；由外部忽略
        }

        is UpdateUiState.Checking -> {
            AlertDialog(
                onDismissRequest = {}, // 检查中不可关闭
                title = { Text("检查更新") },
                text = {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                        Text("正在检查新版本…")
                        Spacer(Modifier.height(16.dp))
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    }
                },
                confirmButton = {},
            )
        }

        is UpdateUiState.UpToDate -> {
            AlertDialog(
                onDismissRequest = { viewModel.dismiss(); onDismiss() },
                title = { Text("检查更新") },
                text = { Text("已是最新版本") },
                confirmButton = {
                    TextButton(onClick = { viewModel.dismiss(); onDismiss() }) {
                        Text("确定")
                    }
                },
            )
        }

        is UpdateUiState.Available -> {
            AlertDialog(
                onDismissRequest = { viewModel.dismiss(); onDismiss() },
                title = { Text("发现新版本 ${s.versionName}") },
                text = {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .verticalScroll(rememberScrollState())
                    ) {
                        Text(s.notes, style = MaterialTheme.typography.bodyMedium)
                    }
                },
                confirmButton = {
                    Button(
                        onClick = { viewModel.startDownload() },
                        colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
                    ) { Text("更新") }
                },
                dismissButton = {
                    TextButton(onClick = { viewModel.dismiss(); onDismiss() }) {
                        Text("稍后")
                    }
                },
            )
        }

        is UpdateUiState.Downloading -> {
            AlertDialog(
                onDismissRequest = {}, // 下载中不可关闭
                title = { Text("下载更新…") },
                text = {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                        LinearProgressIndicator(
                            progress = { s.progress / 100f },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "${s.progress.toInt()}%",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                },
                confirmButton = {},
            )
        }

        is UpdateUiState.ReadyToInstall -> {
            // 下载完即触发 install，不需要额外 UI
            // 空 Compositon：让 dialog 瞬间消失
        }

        is UpdateUiState.Error -> {
            AlertDialog(
                onDismissRequest = { viewModel.dismiss(); onDismiss() },
                title = { Text("更新失败") },
                text = { Text(s.message) },
                confirmButton = {
                    TextButton(onClick = { viewModel.dismiss(); onDismiss() }) {
                        Text("确定")
                    }
                },
            )
        }
    }
}
