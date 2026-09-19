package com.touliao.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ripple.rememberRipple
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.theme.TouliaoMetrics

// ── Shared components（动态主题色，Light/Dark 自动切换）────────────────────────

@Composable
fun TouliaoSettingSection(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(TouliaoMetrics.radiusCard))
            .background(MaterialTheme.colorScheme.surface)
            .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(TouliaoMetrics.radiusCard)),
        content = content,
    )
}

@Composable
fun TouliaoSectionHeader(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = TouliaoMetrics.space5, top = TouliaoMetrics.space5, bottom = TouliaoMetrics.space2),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = TouliaoMetrics.fontSecondary,
        fontWeight = FontWeight.Medium,
    )
}

@Composable
fun TouliaoSettingDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = TouliaoMetrics.space4 + TouliaoMetrics.space6 + TouliaoMetrics.space3),
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}

@Composable
fun TouliaoSettingRow(
    icon: ImageVector,
    title: String,
    trailing: String? = null,
    iconColor: Color? = null,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = TouliaoMetrics.settingHeight)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = rememberRipple(bounded = true),
                onClick = onClick,
            )
            .padding(horizontal = TouliaoMetrics.space4),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(TouliaoMetrics.space6), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = title, tint = iconColor ?: MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(com.touliao.app.ui.IconSize.Sm))
        }
        Spacer(Modifier.width(TouliaoMetrics.space3))
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            fontSize = TouliaoMetrics.fontBody,
            color = MaterialTheme.colorScheme.onSurface,
        )
        if (trailing != null) {
            Text(
                text = trailing,
                fontSize = TouliaoMetrics.fontSecondary,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(end = TouliaoMetrics.space2),
            )
        }
        Icon(
            TouliaoIcons.Disclosure,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.size(com.touliao.app.ui.IconSize.Xs),
        )
    }
}

