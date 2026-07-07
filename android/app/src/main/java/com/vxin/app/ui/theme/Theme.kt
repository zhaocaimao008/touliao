package com.vxin.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = VxinGreen,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    secondary = VxinGreenDark,
    background = VxinBg,
    onBackground = VxinTextPrimary,
    surface = androidx.compose.ui.graphics.Color.White,
    onSurface = VxinTextPrimary,
    surfaceVariant = VxinBg,
    error = VxinError,
)

private val DarkColors = darkColorScheme(
    primary = VxinGreen,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    secondary = VxinGreenDark,
    background = VxinBgDark,
    onBackground = VxinTextPrimaryDark,
    surface = VxinSurfaceDark,
    onSurface = VxinTextPrimaryDark,
    surfaceVariant = VxinSurfaceDark,
    error = VxinError,
)

@Composable
fun VxinTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
