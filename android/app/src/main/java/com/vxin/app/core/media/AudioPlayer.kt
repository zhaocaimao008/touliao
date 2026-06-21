package com.vxin.app.core.media

import android.media.MediaPlayer
import android.util.Log
import javax.inject.Inject
import javax.inject.Singleton

/** 极简语音播放：同一时刻仅播放一条，点其他会先停掉当前。 */
@Singleton
class AudioPlayer @Inject constructor() {
    private var player: MediaPlayer? = null

    fun play(url: String) {
        stop()
        player = MediaPlayer().apply {
            setOnPreparedListener { it.start() }
            setOnCompletionListener { stop() }
            setOnErrorListener { _, what, _ -> Log.w(TAG, "play error $what"); stop(); true }
            runCatching {
                setDataSource(url)
                prepareAsync()
            }.onFailure { Log.e(TAG, "setDataSource failed: ${it.message}"); stop() }
        }
    }

    fun stop() {
        player?.let { runCatching { it.reset() }; runCatching { it.release() } }
        player = null
    }

    private companion object { const val TAG = "AudioPlayer" }
}
