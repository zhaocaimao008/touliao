package com.touliao.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.touliao.app.ui.DesignIcons
import com.touliao.app.ui.theme.VxinTextSize

/** Media controls keep a dark, readable canvas independently of the page theme. */
@Composable
fun CallActionButton(label: String, color: Color, onClick: () -> Unit) {
    val vector = when {
        label == "接听" -> DesignIcons.Phone
        label == "挂断" || label == "拒绝" -> DesignIcons.PhoneOff
        label.contains("回复") -> DesignIcons.MessageSquare
        label.contains("麦克风") || label.contains("静音") -> DesignIcons.Mic
        label == "翻转" -> DesignIcons.SwitchCamera
        label.contains("视频") || label.contains("摄像头") -> DesignIcons.Video
        label == "切语音" -> DesignIcons.Phone
        else -> DesignIcons.Volume2
    }
    Column(Modifier.width(80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(color).clickable(role = Role.Button, onClick = onClick),
            contentAlignment = Alignment.Center) {
            Icon(vector, contentDescription = label, tint = Color.White,
                modifier = Modifier.size(24.dp).drawWithContent {
                    drawContent()
                    if (label.endsWith("关")) drawLine(Color.White, Offset(size.width * .1f, size.height * .1f),
                        Offset(size.width * .9f, size.height * .9f), strokeWidth = 1.8.dp.toPx())
                })
        }
        Spacer(Modifier.height(8.dp))
        Text(label, color = Color.White.copy(alpha = .86f), fontSize = VxinTextSize.xs,
            textAlign = TextAlign.Center, modifier = Modifier.clearAndSetSemantics {})
    }
}
