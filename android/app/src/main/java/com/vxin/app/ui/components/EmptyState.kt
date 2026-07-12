package com.vxin.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vxin.app.ui.theme.VxinBrand
import com.vxin.app.ui.theme.VxinTextPrimary
import com.vxin.app.ui.theme.VxinTextSecondary

/**
 * 统一空态：emoji 图标置于品牌色圆形柔和徽章内 + 主文案 + 可选副文案。
 * 居中显示，用于列表/结果为空时提升观感与友好度（对齐 Web 空态）。
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
        // 图标徽章：极光靛柔和圆底，替代裸 emoji（对齐 Web cl-empty-icon）
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(
                        listOf(VxinBrand.copy(alpha = 0.16f), VxinBrand.copy(alpha = 0.06f))
                    )
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(icon, fontSize = 36.sp)
        }
        Spacer(Modifier.height(16.dp))
        Text(
            title,
            color = VxinTextPrimary,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
        subtitle?.let {
            Spacer(Modifier.height(6.dp))
            Text(
                it,
                color = VxinTextSecondary,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}
