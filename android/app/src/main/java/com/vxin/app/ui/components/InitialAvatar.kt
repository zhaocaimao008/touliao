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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import coil.compose.SubcomposeAsyncImageContent
import kotlin.math.abs

private val palette = listOf(
    Color(0xFF1ABC9C), Color(0xFF3498DB), Color(0xFF9B59B6),
    Color(0xFFE67E22), Color(0xFFE74C3C), Color(0xFF07C160),
)

/**
 * 头像组件：
 * - 传入 avatarUrl(已解析的绝对地址) 且非空时，显示真实头像；
 * - 加载中 / 加载失败 / 无 url 时，回退到文字首字母占位。
 */
@Composable
fun InitialAvatar(name: String, size: Dp = 48.dp, avatarUrl: String? = null) {
    val shape = RoundedCornerShape(size / 6)
    if (!avatarUrl.isNullOrBlank()) {
        SubcomposeAsyncImage(
            model = avatarUrl,
            contentDescription = "头像",
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(size).clip(shape),
            loading = { InitialsBox(name, size, shape) },
            error = { InitialsBox(name, size, shape) },
            success = { SubcomposeAsyncImageContent() },
        )
    } else {
        InitialsBox(name, size, shape)
    }
}

@Composable
private fun InitialsBox(name: String, size: Dp, shape: androidx.compose.ui.graphics.Shape) {
    val letter = name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val color = palette[abs(name.hashCode()) % palette.size]
    Box(
        modifier = Modifier.size(size).clip(shape).background(color),
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
