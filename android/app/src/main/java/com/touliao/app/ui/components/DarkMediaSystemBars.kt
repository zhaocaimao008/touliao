package com.touliao.app.ui.components

import android.app.Activity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.touliao.app.ui.theme.LocalTouliaoPalette
import com.touliao.app.ui.theme.TouliaoLightPalette

/** Full-screen calls use a dark canvas even when the surrounding app uses the light theme. */
@Composable
fun DarkMediaSystemBars() {
    val view = LocalView.current
    val window = (view.context as? Activity)?.window ?: return
    val palette = LocalTouliaoPalette.current
    val currentPalette = rememberUpdatedState(palette)
    val controller = WindowCompat.getInsetsController(window, view)
    DisposableEffect(window) {
        onDispose {
            val light = currentPalette.value == TouliaoLightPalette
            controller.isAppearanceLightStatusBars = light
            controller.isAppearanceLightNavigationBars = light
        }
    }
    // Apply after the surrounding theme's SideEffect; restore its current preference on exit.
    LaunchedEffect(window, palette) {
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
    }
}
