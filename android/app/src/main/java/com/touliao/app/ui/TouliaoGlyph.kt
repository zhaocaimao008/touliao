package com.touliao.app.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp

/** Semantic registry vectors; visual size is independent of the surrounding hit target. */
@Composable
fun TouliaoGlyph(icon: ImageVector, modifier: Modifier = Modifier,
                 color: Color = LocalContentColor.current, size: Dp = IconSize.Sm,
                 label: String? = null) {
    Icon(icon, contentDescription = label, tint = color, modifier = modifier.size(size))
}

fun messageTypeIcon(type: String): ImageVector = when (type) {
    "text" -> TouliaoIcons.Text
    "image", "sticker" -> TouliaoIcons.Image
    "voice" -> TouliaoIcons.Voice
    "video" -> TouliaoIcons.Video
    "file" -> TouliaoIcons.FileContent
    "contact_card", "contact" -> TouliaoIcons.Contact
    "red_packet" -> TouliaoIcons.RedPacket
    "transfer" -> TouliaoIcons.Transfer
    "merged" -> TouliaoIcons.MergedMessages
    "call" -> TouliaoIcons.Phone
    else -> TouliaoIcons.AllTypes
}
