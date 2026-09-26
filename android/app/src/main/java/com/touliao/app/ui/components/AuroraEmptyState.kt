package com.touliao.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.touliao.app.ui.theme.VxinTextPrimary
import com.touliao.app.ui.theme.VxinTextSecondary

/**
 * v3 极光：统一空状态 hero（四端一致）。
 * 深空 + 流动光带 + 星 + 聊天气泡剪影，衬线展示标题 + 单个品牌 CTA。
 * 仅用规范 6 hex：#0B0E1A / #171A26 / #6D5AE6 / #5EEAD4 / #F7F8FC / #E4E7F0
 * （气泡渐变终点 #5A47D6 为规范指定）。
 */
@Composable
fun AuroraChatEmptyState(
    title: String = "还没有消息",
    subtitle: String = "发条消息，打个招呼吧",
    actionLabel: String = "打个招呼",
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        AuroraArt(modifier = Modifier.size(232.dp, 150.dp).clip(RoundedCornerShape(24.dp)))
        Spacer(Modifier.height(28.dp))
        Text(
            title,
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Bold,
            fontSize = 22.sp,
            letterSpacing = 0.4.sp,
            color = VxinTextPrimary,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            subtitle,
            color = VxinTextSecondary,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
        )
        // 单个品牌 CTA：胶囊 + 极光靛渐变（对齐 Web .wc-state-cta）
        if (onAction != null) {
            Spacer(Modifier.height(16.dp))
            TextButton(
                onClick = onAction,
                modifier = Modifier
                    .shadow(
                        elevation = 6.dp,
                        shape = CircleShape,
                        spotColor = Color(0xFF6D5AE6).copy(alpha = 0.35f),
                    )
                    .background(
                        Brush.linearGradient(listOf(Color(0xFF6D5AE6), Color(0xFF5A47D6))),
                        CircleShape,
                    ),
                shape = CircleShape,
                colors = ButtonDefaults.textButtonColors(contentColor = Color.White),
                contentPadding = PaddingValues(horizontal = 28.dp, vertical = 10.dp),
            ) {
                Text(actionLabel, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Color.White)
            }
        }
    }
}

@Composable
private fun AuroraArt(modifier: Modifier = Modifier) {
    val indigo = Color(0xFF6D5AE6)
    val teal = Color(0xFF5EEAD4)
    // 固定星位：避免重组闪烁（对齐 Web hero 星位语言）
    val stars = listOf(
        Triple(0.26f, 0.24f, 1.6f), Triple(0.48f, 0.17f, 1.2f), Triple(0.70f, 0.27f, 2.0f),
        Triple(0.82f, 0.69f, 1.4f), Triple(0.19f, 0.77f, 1.2f), Triple(0.60f, 0.77f, 1.6f),
    )
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        // 渊空底 #0B0E1A
        drawRect(Color(0xFF0B0E1A))
        // 靛紫柔光
        drawRect(
            Brush.radialGradient(
                0.0f to indigo.copy(alpha = 0.25f),
                1.0f to Color.Transparent,
                center = Offset(w * 0.5f, h * 0.45f),
                radius = w * 0.55f,
            ),
        )
        // 流动光带 1：靛 → 青
        val band1 = Path().apply {
            moveTo(w * 0.05f, h * 0.50f)
            cubicTo(w * 0.30f, h * 0.21f, w * 0.45f, h * 0.44f, w * 0.90f, h * 0.37f)
        }
        val brush1 = Brush.linearGradient(
            0.0f to indigo.copy(alpha = 0f),
            0.35f to indigo.copy(alpha = 0.55f),
            0.65f to teal.copy(alpha = 0.35f),
            1.0f to teal.copy(alpha = 0f),
            start = Offset(0f, 0f),
            end = Offset(w, 0f),
        )
        drawPath(band1, brush = brush1, style = Stroke(width = 10f * w / 232f, cap = StrokeCap.Round))
        // 流动光带 2：青 → 靛
        val band2 = Path().apply {
            moveTo(w * 0.05f, h * 0.66f)
            cubicTo(w * 0.32f, h * 0.41f, w * 0.52f, h * 0.60f, w * 0.90f, h * 0.53f)
        }
        val brush2 = Brush.linearGradient(
            0.0f to teal.copy(alpha = 0f),
            0.5f to indigo.copy(alpha = 0.40f),
            1.0f to indigo.copy(alpha = 0f),
            start = Offset(0f, 0f),
            end = Offset(w, 0f),
        )
        drawPath(band2, brush = brush2, style = Stroke(width = 7f * w / 232f, cap = StrokeCap.Round))
        // 星
        stars.forEachIndexed { i, (fx, fy, r) ->
            val c = if (i == 2) teal else Color.White
            drawCircle(c.copy(alpha = 0.5f + (i % 3) * 0.15f), radius = r * w / 232f, center = Offset(w * fx, h * fy))
        }
        // 聊天气泡剪影 + 三点（对齐 Web hero）
        val bw = w * 0.28f
        val bh = h * 0.26f
        val bx = (w - bw) / 2f
        val by = h * 0.37f
        drawRoundRect(
            Color.White.copy(alpha = 0.14f),
            topLeft = Offset(bx, by),
            size = Size(bw, bh),
            cornerRadius = CornerRadius(bw * 0.21f),
        )
        // 小尾巴（锚点角语言）
        val tail = Path().apply {
            moveTo(bx + bw * 0.21f, by + bh - 1f)
            lineTo(bx + bw * 0.14f, by + bh + h * 0.07f)
            lineTo(bx + bw * 0.32f, by + bh - 1f)
            close()
        }
        drawPath(tail, Color.White.copy(alpha = 0.14f))
        // 三点
        for (i in 0..2) {
            drawCircle(
                Color.White.copy(alpha = 0.85f),
                radius = 2.4f * w / 232f,
                center = Offset(bx + bw * (0.32f + 0.18f * i), by + bh * 0.5f),
            )
        }
    }
}
