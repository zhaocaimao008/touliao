package com.vxin.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

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

/** 按用户外观偏好（跟随系统 / 日间 / 夜间）解析是否用暗色。 */
@Composable
fun VxinTheme(
    mode: com.vxin.app.core.storage.ThemeMode,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        com.vxin.app.core.storage.ThemeMode.SYSTEM -> isSystemInDarkTheme()
        com.vxin.app.core.storage.ThemeMode.LIGHT -> false
        com.vxin.app.core.storage.ThemeMode.DARK -> true
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
    val mode by com.vxin.app.core.storage.ThemeStore.live.collectAsState()
    VxinTheme(mode = mode, content = content)
}
