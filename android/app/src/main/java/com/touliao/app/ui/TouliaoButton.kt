package com.touliao.app.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import com.touliao.app.ui.theme.TouliaoMetrics

enum class TouliaoButtonVariant { PRIMARY, SECONDARY, GHOST, TEXT, DANGER }

/** Public name retained; the supplied design uses a flat, accessible primary button. */
@Composable
fun TouliaoButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier,
                       enabled: Boolean = true, loading: Boolean = false,
                       variant: TouliaoButtonVariant = TouliaoButtonVariant.PRIMARY) {
    val palette = MaterialTheme.colorScheme
    val surface = when (variant) {
        TouliaoButtonVariant.PRIMARY -> palette.primary
        TouliaoButtonVariant.SECONDARY -> palette.surfaceVariant
        TouliaoButtonVariant.DANGER -> palette.errorContainer
        else -> Color.Transparent
    }
    val foreground = when (variant) {
        TouliaoButtonVariant.PRIMARY -> palette.onPrimary
        TouliaoButtonVariant.SECONDARY -> palette.onSurface
        TouliaoButtonVariant.DANGER -> palette.onErrorContainer
        else -> palette.primary
    }
    Button(onClick = onClick, enabled = enabled && !loading,
        colors = ButtonDefaults.buttonColors(
            containerColor = surface, contentColor = foreground,
            disabledContainerColor = if (loading) surface else MaterialTheme.colorScheme.onSurface.copy(alpha = .12f),
            disabledContentColor = if (loading) foreground else MaterialTheme.colorScheme.onSurface.copy(alpha = .38f),
        ),
        shape = RoundedCornerShape(TouliaoMetrics.radiusControl), contentPadding = PaddingValues(16.dp, 12.dp),
        modifier = modifier.fillMaxWidth().heightIn(min = TouliaoMetrics.buttonHeight)) {
        Box(contentAlignment = Alignment.Center) {
            Text(text, style = MaterialTheme.typography.labelLarge, modifier = Modifier.alpha(if (loading) 0f else 1f))
            if (loading) CircularProgressIndicator(Modifier.size(20.dp),
                color = foreground, strokeWidth = 2.dp)
        }
    }
}

// Deprecated name retained as a compatibility delegate, not a separate style.
@Composable
fun VxinGradientButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier,
                       enabled: Boolean = true, loading: Boolean = false) =
    TouliaoButton(text, onClick, modifier, enabled, loading)
