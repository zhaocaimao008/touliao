package com.touliao.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import coil.compose.SubcomposeAsyncImageContent
import com.touliao.app.core.util.mediaResolver
import com.touliao.app.ui.theme.TouliaoMetrics

/**
 * 头像组件：
 * - avatarUrl 可以是服务端原始值（/uploads/... 相对路径）或已解析的绝对地址，这里统一解析；
 * - 加载中 / 加载失败 / 无 url 时，回退到文字首字母占位（不会出现空白头像）。
 */
@Composable
fun InitialAvatar(
    name: String,
    size: Dp = TouliaoMetrics.avatarList,
    avatarUrl: String? = null,
    // v4：个人头像统一圆形（四端一致）；群头像等可传圆角矩形
    shape: Shape = CircleShape,
) {
    val context = LocalContext.current
    val model = remember(avatarUrl) {
        if (avatarUrl.isNullOrBlank()) null
        else runCatching { mediaResolver(context).resolve(avatarUrl) }.getOrDefault(avatarUrl)
    }
    if (!model.isNullOrBlank()) {
        SubcomposeAsyncImage(
            model = model,
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
private fun InitialsBox(name: String, size: Dp, shape: Shape) {
    val letter = name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    val color = MaterialTheme.colorScheme.primaryContainer
    Box(
        modifier = Modifier.size(size).clip(shape).background(color),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = letter,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.titleMedium,
        )
    }
}
