package com.vxin.app.feature.profile

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyQrCodeScreen(
    onBack: () -> Unit,
    viewModel: MyQrCodeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val user = state.user

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("我的二维码") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            InitialAvatar(name = user?.username ?: "?", size = 64.dp)
            Spacer(Modifier.size(8.dp))
            Text(user?.username ?: "", style = MaterialTheme.typography.titleMedium)
            user?.wechat_id?.takeIf { it.isNotBlank() }?.let {
                Text("v信号: $it", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.size(32.dp))

            when {
                state.loading -> CircularProgressIndicator()
                state.qr != null -> {
                    val bmp = remember(state.qr) {
                        BitmapFactory.decodeByteArray(state.qr, 0, state.qr!!.size)
                    }
                    if (bmp != null) {
                        Image(bmp.asImageBitmap(), contentDescription = "我的二维码", modifier = Modifier.size(240.dp))
                    } else {
                        Text("二维码解析失败", color = VxinTextSecondary)
                    }
                }
                else -> Text(state.error ?: "二维码加载失败", color = VxinTextSecondary)
            }

            Spacer(Modifier.size(24.dp))
            Text("扫一扫上面的二维码，添加我为好友", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
        }
    }
}
