package com.vxin.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.vxin.app.ui.theme.VxinBrandDark
import com.vxin.app.ui.theme.VxinBrandLight
import com.vxin.app.ui.theme.VxinTextSecondary

/**
 * v信 主按钮：极光靛渐变实心药丸 + 加载态（对齐 Web 主按钮 / 登录注册页）。
 * 统一各处 CTA 视觉，避免重复渐变 Box 样板代码。
 */
@Composable
fun VxinGradientButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        contentPadding = PaddingValues(),
        colors = ButtonDefaults.buttonColors(
            containerColor = Color.Transparent,
            disabledContainerColor = Color.Transparent,
        ),
        modifier = modifier.fillMaxWidth().height(50.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(50.dp)
                .clip(RoundedCornerShape(25.dp))
                .background(
                    if (enabled)
                        Brush.linearGradient(listOf(VxinBrandLight, VxinBrandDark))
                    else Brush.linearGradient(listOf(VxinTextSecondary, VxinTextSecondary))
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (loading) {
                CircularProgressIndicator(Modifier.height(20.dp), color = Color.White, strokeWidth = 2.dp)
            } else {
                Text(text, color = Color.White, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
