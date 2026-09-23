package com.touliao.app.ui.components

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.touliao.app.ui.TouliaoButton
import com.touliao.app.ui.TouliaoButtonVariant
import com.touliao.app.ui.theme.VxinBrand
import com.touliao.app.ui.theme.VxinTextPrimary
import com.touliao.app.ui.theme.VxinTextSecondary

/**
 * 统一空态：线性图标置于品牌色圆形柔和徽章内 + 主文案 + 可选副文案。
 * 居中显示，用于列表/结果为空时提升观感与友好度（对齐 Web 空态）。
 */
@Composable
fun EmptyState(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    isError: Boolean = false,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(com.touliao.app.ui.theme.TouliaoMetrics.space8),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // 图标徽章：主题柔和圆底，替代裸 emoji（对齐 Web cl-empty-icon）
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(CircleShape)
                .background(androidx.compose.material3.MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            androidx.compose.material3.Icon(
                icon, contentDescription = null, modifier = Modifier.size(com.touliao.app.ui.IconSize.Lg), tint = if (isError) androidx.compose.material3.MaterialTheme.colorScheme.error else VxinBrand,
            )
        }
        Spacer(Modifier.height(16.dp))
        Text(
            title,
            color = if (isError) androidx.compose.material3.MaterialTheme.colorScheme.error else VxinTextPrimary,
            fontSize = com.touliao.app.ui.theme.VxinTextSize.md,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
        subtitle?.let {
            Spacer(Modifier.height(6.dp))
            Text(
                it,
                color = VxinTextSecondary,
                fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2,
                textAlign = TextAlign.Center,
            )
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(com.touliao.app.ui.theme.TouliaoMetrics.space4))
            TouliaoButton(text = actionLabel, onClick = onAction, variant = TouliaoButtonVariant.SECONDARY)
        }
    }
}
