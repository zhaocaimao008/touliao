package com.vxin.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs

private val palette = listOf(
    Color(0xFF1ABC9C), Color(0xFF3498DB), Color(0xFF9B59B6),
    Color(0xFFE67E22), Color(0xFFE74C3C), Color(0xFF07C160),
)

/** 文字首字母头像（对齐 Web 端无头像时的占位风格），避免引入图片库 */
@Composable
fun InitialAvatar(name: String, size: Dp = 48.dp) {
    val letter = name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val color = palette[abs(name.hashCode()) % palette.size]
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(size / 6))
            .background(color),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = letter,
            color = Color.White,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.titleMedium,
        )
    }
}
