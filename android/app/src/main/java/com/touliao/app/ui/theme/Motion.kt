package com.touliao.app.ui.theme

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally

/**
 * 投聊导航转场规范（Material 3）。
 * 进入：右侧滑入 + 淡入；退出：左侧滑出 + 淡出；返回时镜像。
 * 时长 300ms，替代系统默认 700ms 淡入淡出。
 */
object TouliaoMotion {
    const val DURATION_MS = 300

    val enter: EnterTransition
        get() = slideInHorizontally(
            initialOffsetX = { it / 3 },
            animationSpec = tween(DURATION_MS)
        ) + fadeIn(animationSpec = tween(DURATION_MS))

    val exit: ExitTransition
        get() = slideOutHorizontally(
            targetOffsetX = { -it / 3 },
            animationSpec = tween(DURATION_MS)
        ) + fadeOut(animationSpec = tween(DURATION_MS))

    val popEnter: EnterTransition
        get() = slideInHorizontally(
            initialOffsetX = { -it / 3 },
            animationSpec = tween(DURATION_MS)
        ) + fadeIn(animationSpec = tween(DURATION_MS))

    val popExit: ExitTransition
        get() = slideOutHorizontally(
            targetOffsetX = { it / 3 },
            animationSpec = tween(DURATION_MS)
        ) + fadeOut(animationSpec = tween(DURATION_MS))
}
