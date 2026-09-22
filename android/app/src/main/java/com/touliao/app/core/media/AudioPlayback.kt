package com.touliao.app.core.media

/** Owns exactly one player. Late callbacks from a replaced/released player are ignored. */
internal class AudioPlayback(private val create: () -> Device) {
    interface Device {
        fun prepare(url: String, ready: () -> Unit, done: () -> Unit, failed: () -> Unit)
        fun start()
        fun release()
    }
    private var active: Device? = null
    @Synchronized fun play(url: String, onFailure: (String) -> Unit) {
        stop()
        var current: Device? = null
        fun failed() {
            if (current == null || active === current) {
                stop()
                onFailure("语音播放失败，请检查网络或稍后重试")
            }
        }
        try {
            val device = create()
            current = device
            active = device
            device.prepare(url, {
                synchronized(this) {
                    if (active === device) try { device.start() } catch (_: Exception) { failed() }
                }
            }, {
                synchronized(this) { if (active === device) stop() }
            }, { synchronized(this) { failed() } })
        } catch (_: Exception) { failed() }
    }
    @Synchronized fun stop() {
        val old = active
        active = null
        try { old?.release() } catch (_: Exception) { /* Already released; never claim playback success. */ }
    }
}
