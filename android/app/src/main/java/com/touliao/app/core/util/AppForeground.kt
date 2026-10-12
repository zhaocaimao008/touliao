package com.touliao.app.core.util

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 进程级前后台状态（2026-10-12）。由 MessageNotificationBridge 的 ActivityLifecycleCallbacks
 * 计数驱动（started Activity 数 > 0 = 前台），供后台断开 socket、后台不上报已读等逻辑订阅。
 * 未引入 lifecycle-process 依赖，沿用已有的计数器作为唯一事实来源。
 */
object AppForeground {
    private val _state = MutableStateFlow(false)
    val state: StateFlow<Boolean> = _state.asStateFlow()
    val isForeground: Boolean get() = _state.value

    internal fun set(foreground: Boolean) { _state.value = foreground }
}
