package com.touliao.app.core.media

import android.media.MediaPlayer
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AudioPlayer @Inject constructor() {
    private val playback = AudioPlayback {
        val player = MediaPlayer()
        object : AudioPlayback.Device {
            override fun prepare(url: String, ready: () -> Unit, done: () -> Unit, failed: () -> Unit) {
                player.setOnPreparedListener { ready() }
                player.setOnCompletionListener { done() }
                player.setOnErrorListener { _, _, _ -> failed(); true }
                player.setDataSource(url) // Only a short-lived media ticket reaches this API.
                player.prepareAsync()
            }
            override fun start() = player.start()
            override fun release() { player.release() }
        }
    }
    fun play(url: String, onFailure: (String) -> Unit) = playback.play(url, onFailure)
    fun stop() = playback.stop()
}
