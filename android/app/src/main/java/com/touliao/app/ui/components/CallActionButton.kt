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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.IconSize
import com.touliao.app.ui.IconColor
import com.touliao.app.ui.theme.VxinTextSize
import com.touliao.app.ui.theme.TouliaoMetrics

/** Audio routes use distinct semantic glyphs; callbacks and routing stay with the call screen. */
@Composable
fun CallActionButton(label: String, color: Color, onClick: () -> Unit) {
    val vector = when {
        label == "接听" -> TouliaoIcons.AcceptCall
        label == "挂断" -> TouliaoIcons.Hangup
        label == "拒绝" -> TouliaoIcons.RejectCall
        label.contains("回复") -> TouliaoIcons.Message
        label.contains("蓝牙") -> if (label.endsWith("关")) TouliaoIcons.BluetoothOff else TouliaoIcons.Bluetooth
        label.contains("听筒") || label == "扬声器关" -> TouliaoIcons.Earpiece
        label.contains("麦克风") || label.contains("静音") -> if (label.endsWith("关")) TouliaoIcons.MicrophoneMuted else TouliaoIcons.Microphone
        label == "翻转" -> TouliaoIcons.CameraSwitch
        label.contains("视频") || label.contains("摄像头") -> if (label.endsWith("关")) TouliaoIcons.CameraOff else TouliaoIcons.Video
        label == "切语音" -> TouliaoIcons.Phone
        else -> TouliaoIcons.Speaker
    }
    Column(Modifier.width(80.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(TouliaoMetrics.callControlSize).clip(CircleShape).background(color).clickable(role = Role.Button, onClick = onClick),
            contentAlignment = Alignment.Center) {
            Icon(vector, contentDescription = label, tint = IconColor.OnDark, modifier = Modifier.size(IconSize.Md))
        }
        Spacer(Modifier.height(8.dp))
        Text(label, color = IconColor.OnDark.copy(alpha = .86f), fontSize = VxinTextSize.xs,
            textAlign = TextAlign.Center, modifier = Modifier.clearAndSetSemantics {})
    }
}
