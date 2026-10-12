package com.touliao.app.core.call

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 「首次使用才初始化、只初始化一次、可在后台线程挂起等待」的通用持有器。
 * 抽成与 WebRTC 无关的纯逻辑，便于单测（并发只建一次 / 失败可重试 / 未初始化时 getOrNull 不触发）。
 */
internal class OnceInitializer<T : Any>(
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
    private val create: () -> T,
) {
    @Volatile private var value: T? = null
    private val lock = Any()

    /** 已初始化则返回，否则 null（不触发初始化）。 */
    fun getOrNull(): T? = value

    /** 同步获取（必要时在当前线程初始化）；create 抛异常时不缓存，下次调用重试。 */
    fun get(): T {
        value?.let { return it }
        synchronized(lock) {
            value?.let { return it }
            return create().also { value = it }
        }
    }

    /** 挂起直到就绪；初始化在 [dispatcher] 上执行，不占调用方（主）线程。 */
    suspend fun await(): T = value ?: withContext(dispatcher) { get() }
}

/**
 * 1v1 [CallManager] 与群通话 [GroupCallManager] 共用的 WebRTC 工厂（2026-10-12 性能修复）。
 *
 * 此前两个 Manager 各自在 init 里 PeerConnectionFactory.initialize + 建工厂 + EglBase.create()，
 * 且都被 MainActivity 注入 → 每次冷启动都在主线程加载 ~11MB 的 WebRTC .so 并建两套工厂/EGL。
 * 现在改为：首次真正需要时（拨出 / 来电进入 INCOMING 预热 / 接听 / 群通话发起或加入）才在后台
 * 线程初始化一次，两个 Manager 共享同一个工厂与 EGL 上下文（两者互斥使用，从不同时有媒体）。
 *
 * 线程：initialize 与 createPeerConnectionFactory 允许在任意线程调用；这里统一放 Default，
 * 建连路径用 [await] 挂起等待。[getOrNull] 供通话中（工厂必然已就绪）的同步路径使用。
 */
@Singleton
class WebRtcFactoryHolder @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    /** 渲染（SurfaceViewRenderer.init）与编解码共用的 EGL 上下文；首次访问才创建。 */
    val eglBase: EglBase by lazy { EglBase.create() }

    private val factory = OnceInitializer {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setFieldTrials(CALL_FIELD_TRIALS)
                .createInitializationOptions()
        )
        PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    /** 已初始化则返回工厂，否则 null（不触发初始化）。 */
    fun getOrNull(): PeerConnectionFactory? = factory.getOrNull()

    /** 挂起直到工厂就绪（后台线程初始化）。 */
    suspend fun await(): PeerConnectionFactory = factory.await()

    /** 来电响铃时提前在后台预热：用户点接听时工厂通常已就绪。失败静默，建连时 await 会再试。 */
    fun prewarm(scope: CoroutineScope) {
        if (factory.getOrNull() != null) return
        scope.launch(Dispatchers.Default) {
            runCatching { factory.get() }.onFailure { Log.w(TAG, "WebRTC 预热失败: ${it.message}") }
        }
    }

    private companion object { const val TAG = "WebRtcFactoryHolder" }
}
