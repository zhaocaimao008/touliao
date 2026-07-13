package com.vxin.app.core.storage

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** 外观模式：跟随系统 / 日间 / 夜间。对齐 Web 的 themeMode。 */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

/**
 * 主题偏好持久化（本地，非服务端）。以 StateFlow 暴露，供根组件订阅后即时换肤。
 */
@Singleton
class ThemeStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("vxin_theme", Context.MODE_PRIVATE)

    val mode: StateFlow<ThemeMode> get() = live

    init {
        // 首次注入时把已持久化的偏好同步进全局 live 流（幂等）。
        live.value = read()
    }

    private fun read(): ThemeMode = runCatching {
        ThemeMode.valueOf(prefs.getString(KEY, ThemeMode.SYSTEM.name) ?: ThemeMode.SYSTEM.name)
    }.getOrDefault(ThemeMode.SYSTEM)

    fun set(mode: ThemeMode) {
        prefs.edit().putString(KEY, mode.name).apply()
        live.value = mode
    }

    companion object {
        private const val KEY = "theme_mode"
        /**
         * 全局主题状态（进程级）。供根 Composable 无需 DI 直接订阅，切换即时生效；
         * 初值由 App 启动时从 prefs 同步一次（见 syncInitial）。
         */
        val live = MutableStateFlow(ThemeMode.SYSTEM)

        /** 启动时（Application.onCreate）同步一次持久化偏好，保证首帧就是用户选择的主题。 */
        fun syncInitial(context: Context) {
            runCatching {
                val raw = context.getSharedPreferences("vxin_theme", Context.MODE_PRIVATE)
                    .getString(KEY, ThemeMode.SYSTEM.name) ?: ThemeMode.SYSTEM.name
                live.value = ThemeMode.valueOf(raw)
            }
        }
    }
}
