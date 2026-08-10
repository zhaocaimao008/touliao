package com.vxin.app.core.capture

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.io.File

/**
 * 全屏截图事件总线：ScreenCaptureService 截到一帧落地成 PNG 后，
 * 通过它把文件发给发起截图的 ChatViewModel（后者订阅并上传发送）。
 *
 * 单发（replay=1）保证：即使 ViewModel 因界面切换稍慢一步订阅，也能收到最近一次结果；
 * 消费方消费后应调用 [clear] 复位，避免旧结果被重复消费。
 */
object ScreenCaptureBus {
    private val _events = MutableSharedFlow<File>(replay = 1, extraBufferCapacity = 1)
    val events: SharedFlow<File> = _events.asSharedFlow()

    fun emit(file: File) { _events.tryEmit(file) }

    /** 消费后复位 replay 缓存，防止重复消费（消费方以自身「等待中」标志位 gate，
     * 见 ChatViewModel.awaitingScreenshot）。 */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun resetReplay() { _events.resetReplayCache() }
}
