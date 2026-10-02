package com.touliao.app.core.call

import android.content.Context
import org.webrtc.audio.AudioDeviceModule
import org.webrtc.audio.JavaAudioDeviceModule

/**
 * 通话音频设备：关闭机型自带的硬件回声消除/降噪，统一用 WebRTC 软件 AEC/NS。
 * 默认 ADM 在设备声明支持时启用硬件 AEC 并关掉软件 AEC，但不少机型的硬件 AEC 效果差，
 * 外放时对端会听到自己的回声（话说完后从听筒里重复）并伴随杂音。
 */
internal fun createCallAudioDeviceModule(context: Context): AudioDeviceModule =
    JavaAudioDeviceModule.builder(context)
        .setUseHardwareAcousticEchoCanceler(false)
        .setUseHardwareNoiseSuppressor(false)
        .createAudioDeviceModule()
