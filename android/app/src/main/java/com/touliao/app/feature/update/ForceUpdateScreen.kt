package com.touliao.app.feature.update

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.touliao.app.ui.theme.VxinBrand

/**
 * 当前版本低于后台最低版本（/api/config minVersion.android）时的整屏拦截页。
 * 不提供关闭/跳过入口；更新流程复用 UpdateCheckDialog（下载 → SHA-256/versionCode 校验 → 安装）。
 */
@Composable
fun ForceUpdateScreen(viewModel: UpdateViewModel = hiltViewModel()) {
    var showDialog by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("需要更新", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(12.dp))
        Text(
            "当前版本已停止支持，请更新到最新版本后继续使用。",
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = { showDialog = true; viewModel.openDialog() },
            colors = ButtonDefaults.buttonColors(containerColor = VxinBrand),
            modifier = Modifier.fillMaxWidth(),
        ) { Text("立即更新") }
    }
    if (showDialog) UpdateCheckDialog(viewModel = viewModel, onDismiss = { showDialog = false })
}
