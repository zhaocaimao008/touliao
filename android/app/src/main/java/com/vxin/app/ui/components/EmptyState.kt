package com.vxin.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vxin.app.ui.theme.VxinTextSecondary

/**
 * 统一空态：emoji 图标 + 主文案 + 可选副文案。
 * 居中显示，用于列表/结果为空时提升观感与友好度。
 */
@Composable
fun EmptyState(
    icon: String,
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(icon, fontSize = 48.sp)
        Spacer(Modifier.height(12.dp))
        Text(
            title,
            color = VxinTextSecondary,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
        subtitle?.let {
            Spacer(Modifier.height(6.dp))
            Text(
                it,
                color = VxinTextSecondary.copy(alpha = 0.7f),
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}
