package com.touliao.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * v4 悬浮胶囊导航栏（Material 3 Expressive 风格，基于 material3 1.2 实现）。
 * 离开屏幕底边悬浮、32dp 圆角、选中项为带弹性缩放的胶囊指示。
 * 与 Web/iOS 的悬浮玻璃标签栏同构；颜色取自 MaterialTheme（含动态取色）。
 */
@Composable
fun FloatingNavBar(
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    Box(
        modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(start = 12.dp, end = 12.dp, bottom = 10.dp, top = 4.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(32.dp),
            color = scheme.surface.copy(alpha = 0.96f),
            modifier = Modifier
                .fillMaxWidth()
                .height(68.dp)
                .shadow(elevation = 16.dp, shape = RoundedCornerShape(32.dp), ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.14f))
                .border(1.dp, scheme.outlineVariant.copy(alpha = 0.5f), RoundedCornerShape(32.dp)),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
                content = content,
            )
        }
    }
}

@Composable
fun RowScope.FloatingNavItem(
    selected: Boolean,
    onClick: () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    icon: @Composable () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    val indicator by animateColorAsState(if (selected) scheme.primaryContainer else Color.Transparent, label = "navIndicator")
    val content by animateColorAsState(if (selected) scheme.onPrimaryContainer else scheme.onSurfaceVariant, label = "navContent")
    val iconScale by animateFloatAsState(
        targetValue = if (selected) 1.08f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow),
        label = "navScale",
    )
    Column(
        modifier
            .weight(1f)
            .fillMaxHeight()
            .clip(RoundedCornerShape(26.dp))
            .background(indicator)
            .selectable(
                selected = selected,
                onClick = onClick,
                role = Role.Tab,
                interactionSource = remember { MutableInteractionSource() },
                indication = androidx.compose.material.ripple.rememberRipple(bounded = true),
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.size(26.dp).scale(iconScale), contentAlignment = Alignment.Center) {
            androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides content) { icon() }
        }
        Text(
            label,
            color = content,
            fontSize = 11.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            maxLines = 1,
        )
    }
}
