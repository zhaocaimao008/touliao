package com.vxin.app.feature.group

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupQrScreen(
    onBack: () -> Unit,
    viewModel: GroupQrViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("群聊二维码") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            val qr = state.qr
            when {
                state.loading -> CircularProgressIndicator()
                qr != null -> {
                    val bmp = remember(qr.qrCode) { decodeDataUrl(qr.qrCode) }
                    if (bmp != null) {
                        Image(bmp.asImageBitmap(), contentDescription = "群二维码", modifier = Modifier.size(240.dp))
                    } else {
                        Text("二维码解析失败", color = VxinTextSecondary)
                    }
                    Spacer(Modifier.size(16.dp))
                    Text("扫一扫上面的二维码，加入群聊", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.size(24.dp))
                    Text(qr.url, color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.size(8.dp))
                    Button(
                        onClick = { clipboard.setText(AnnotatedString(qr.url)) },
                        colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("复制邀请链接") }
                    Text("链接 7 天内有效", color = VxinTextSecondary, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 8.dp))
                }
                else -> Text(state.error ?: "二维码加载失败", color = VxinTextSecondary)
            }
        }
    }
}

/** 解码 data:image/png;base64,XXX */
private fun decodeDataUrl(dataUrl: String): android.graphics.Bitmap? {
    val base64 = dataUrl.substringAfter("base64,", "")
    if (base64.isEmpty()) return null
    return runCatching {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }.getOrNull()
}
