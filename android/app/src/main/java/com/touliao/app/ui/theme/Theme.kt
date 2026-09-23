package com.touliao.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape

private fun colors(p: TouliaoPalette, dark: Boolean) = if (dark) darkColorScheme(
    primary = p.primary, onPrimary = p.primaryForeground,
    primaryContainer = p.primarySoft, onPrimaryContainer = p.primary,
    secondary = p.primary, onSecondary = p.primaryForeground,
    secondaryContainer = p.primarySoft, onSecondaryContainer = p.text,
    background = p.background, onBackground = p.text,
    surface = p.surface, onSurface = p.text,
    surfaceVariant = p.surfaceSecondary, onSurfaceVariant = p.readableMuted,
    surfaceTint = androidx.compose.ui.graphics.Color.Transparent,
    error = p.readableDanger, onError = p.primaryForeground,
    errorContainer = p.dangerSoft, onErrorContainer = p.readableDanger,
    outline = p.borderStrong, outlineVariant = p.border,
) else lightColorScheme(
    primary = p.primary, onPrimary = p.primaryForeground,
    primaryContainer = p.primarySoft, onPrimaryContainer = p.primary,
    secondary = p.primary, onSecondary = p.primaryForeground,
    secondaryContainer = p.primarySoft, onSecondaryContainer = p.text,
    background = p.background, onBackground = p.text,
    surface = p.surface, onSurface = p.text,
    surfaceVariant = p.surfaceSecondary, onSurfaceVariant = p.readableMuted,
    surfaceTint = androidx.compose.ui.graphics.Color.Transparent,
    error = p.readableDanger, onError = p.primaryForeground,
    errorContainer = p.dangerSoft, onErrorContainer = p.readableDanger,
    outline = p.borderStrong, outlineVariant = p.border,
)

private fun type(size: TextUnit, leading: Float = 1.6f, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = FontFamily.SansSerif, fontSize = size, lineHeight = size * leading,
    fontWeight = weight, letterSpacing = 0.sp,
)
private val TouliaoTypography = Typography(
    displayLarge = type(TouliaoMetrics.fontDisplay, 1.3f, FontWeight.SemiBold),
    displayMedium = type(TouliaoMetrics.fontDisplay, 1.3f, FontWeight.SemiBold),
    displaySmall = type(TouliaoMetrics.fontTitle, 1.3f, FontWeight.SemiBold),
    headlineLarge = type(TouliaoMetrics.fontTitle, 1.3f, FontWeight.SemiBold),
    headlineMedium = type(TouliaoMetrics.fontTitle, 1.3f, FontWeight.SemiBold),
    headlineSmall = type(20.sp, 1.3f, FontWeight.SemiBold),
    titleLarge = type(TouliaoMetrics.fontTitle, 1.3f, FontWeight.SemiBold),
    titleMedium = type(TouliaoMetrics.fontHeadline, 1.3f, FontWeight.SemiBold),
    titleSmall = type(TouliaoMetrics.fontBody, 1.4f, FontWeight.Medium),
    bodyLarge = type(TouliaoMetrics.fontBody), bodyMedium = type(TouliaoMetrics.fontBody), bodySmall = type(TouliaoMetrics.fontCaption),
    labelLarge = type(TouliaoMetrics.fontBody, 1.4f, FontWeight.Medium),
    labelMedium = type(TouliaoMetrics.fontSecondary, 1.4f, FontWeight.Medium), labelSmall = type(TouliaoMetrics.fontCaption, 1.4f),
)

@Composable
fun VxinTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val palette = if (darkTheme) TouliaoDarkPalette else TouliaoLightPalette
    val view = androidx.compose.ui.platform.LocalView.current
    androidx.compose.runtime.SideEffect {
        val window = (view.context as? android.app.Activity)?.window
        if (window != null) {
            androidx.core.view.WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalTouliaoPalette provides palette) {
        MaterialTheme(
            colorScheme = colors(palette, darkTheme), typography = TouliaoTypography,
            shapes = androidx.compose.material3.Shapes(
                extraSmall = RoundedCornerShape(TouliaoMetrics.radiusSmall), small = RoundedCornerShape(TouliaoMetrics.radiusSmall),
                medium = RoundedCornerShape(TouliaoMetrics.radiusControl), large = RoundedCornerShape(TouliaoMetrics.radiusDialog),
                extraLarge = RoundedCornerShape(TouliaoMetrics.radiusDialog),
            ), content = content,
        )
    }
}

/** 按用户外观偏好（跟随系统 / 日间 / 夜间）解析是否用暗色。 */
@Composable
fun VxinTheme(
    mode: com.touliao.app.core.storage.ThemeMode,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        com.touliao.app.core.storage.ThemeMode.SYSTEM -> isSystemInDarkTheme()
        com.touliao.app.core.storage.ThemeMode.LIGHT -> false
        com.touliao.app.core.storage.ThemeMode.DARK -> true
    }
    VxinTheme(darkTheme = dark, content = content)
}

/**
 * 启动根用：直接从 SharedPreferences 同步读取外观偏好（无 DI、无 Flow 收集），
 * 启动路径与 1.0.14 一致、零崩溃风险。切换外观在下次重组/重启后生效。
 */
@Composable
fun VxinThemeWithPref(content: @Composable () -> Unit) {
    // 订阅全局主题流（模块级 StateFlow，无 DI、无 LifecycleOwner 依赖）：
    // 切换外观即时重组换肤；初值已由 App 启动时从 prefs 同步。
    val mode by com.touliao.app.core.storage.ThemeStore.live.collectAsState()
    VxinTheme(mode = mode, content = content)
}
