package com.touliao.app.core.call

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 界面在场标记（跨包契约 C3）：记录 CallActivity / MainActivity 当前是否处于 STARTED。
 * - [callUiStarted]：由 CallActivity 在 onStart / onStop 写入；MainActivity 据此避免重复拉起通话页。
 * - [mainUiStarted]：由 MainActivity 在 onStart / onStop 写入；群邀请据此决定"横幅 + 短振"还是"系统通知"。
 * 配置变更引起的 onStop 不写 false（由调用方判断 isChangingConfigurations）。
 */
object CallUiPresence {
    private val _callUiStarted = MutableStateFlow(false)
    val callUiStarted: StateFlow<Boolean> = _callUiStarted.asStateFlow()

    private val _mainUiStarted = MutableStateFlow(false)
    val mainUiStarted: StateFlow<Boolean> = _mainUiStarted.asStateFlow()

    fun setCallUiStarted(started: Boolean) {
        _callUiStarted.value = started
    }

    fun setMainUiStarted(started: Boolean) {
        _mainUiStarted.value = started
    }
}
