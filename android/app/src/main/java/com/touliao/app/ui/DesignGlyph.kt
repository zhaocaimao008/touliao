package com.touliao.app.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Legacy decorative glyph call sites now use the supplied vector geometry. */
@Composable
fun DesignGlyph(symbol: String, modifier: Modifier = Modifier,
                color: Color = LocalContentColor.current, fontSize: TextUnit = 20.sp,
                style: TextStyle = TextStyle.Default) {
    val (vector, label) = when (symbol) {
        "›" -> DesignIcons.ChevronRight to null
        "▶" -> DesignIcons.Play to "播放"
        "✕" -> DesignIcons.X to "关闭"
        "✓" -> DesignIcons.Check to "已选择"
        "＋" -> DesignIcons.Plus to "添加"
        "📄" -> DesignIcons.FileText to "文件"
        "🔍" -> DesignIcons.Search to "搜索"
        "📞" -> DesignIcons.Phone to "语音通话"
        "📹", "🎬" -> DesignIcons.Video to "视频"
        "🖼" -> DesignIcons.Image to "图片"
        "↓" -> DesignIcons.ArrowDown to "向下"
        "📢" -> DesignIcons.Megaphone to "公告"
        "📌" -> DesignIcons.Pin to "置顶"
        "…" -> DesignIcons.Ellipsis to "更多"
        "🗄" -> DesignIcons.Folder to "归档"
        "🔕" -> DesignIcons.Bell to "消息免打扰"
        "⌄", "▾" -> DesignIcons.ChevronDown to "展开"
        "🔔" -> DesignIcons.Bell to "通知"
        "⚙️" -> DesignIcons.Settings to "设置"
        "📷" -> DesignIcons.Camera to "相机"
        "💬" -> DesignIcons.MessageCircle to "评论"
        else -> DesignIcons.CircleHelp to null
    }
    val size = (if (style.fontSize != TextUnit.Unspecified) style.fontSize.value else fontSize.value).coerceIn(16f, 32f)
    Icon(vector, contentDescription = label, tint = color, modifier = modifier.size(size.dp).drawWithContent {
        drawContent()
        if (symbol == "🔕") drawLine(color, Offset(this.size.width * .15f, this.size.height * .15f),
            Offset(this.size.width * .85f, this.size.height * .85f), strokeWidth = 1.8.dp.toPx())
    })
}
