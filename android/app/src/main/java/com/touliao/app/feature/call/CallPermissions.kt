package com.touliao.app.feature.call

import android.Manifest
import android.os.Build

/**
 * 通话运行时权限分组（CALL-9/CALL-M1 蓝牙误报）。
 * - 必需：麦克风；视频通话再加摄像头。缺了对方听不到/看不到，需要提示用户。
 * - 可选：BLUETOOTH_CONNECT（Android 12+ 切蓝牙耳机用）。被拒只是不显示蓝牙按钮，不提示、不弹"去设置"。
 * 此前三者放在一起判断，用户只拒绝"附近的设备"也会被报成"缺少麦克风/摄像头权限"。
 * 纯函数，sdkInt 由调用方传入，便于 JVM 单测。
 */
internal object CallPermissions {

    /** 必需权限：麦克风；视频通话再加摄像头 */
    fun required(isVideo: Boolean): List<String> =
        if (isVideo) listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
        else listOf(Manifest.permission.RECORD_AUDIO)

    /** 可选权限：蓝牙耳机音频路由需要 BLUETOOTH_CONNECT(Android 12+)；老系统上此权限不存在 */
    fun optional(sdkInt: Int): List<String> =
        if (sdkInt >= Build.VERSION_CODES.S) listOf(Manifest.permission.BLUETOOTH_CONNECT) else emptyList()

    /** 进入通话时一次申请的全部权限（必需 + 可选） */
    fun toRequest(isVideo: Boolean, sdkInt: Int): Array<String> =
        (required(isVideo) + optional(sdkInt)).toTypedArray()

    /**
     * 申请结果里被拒绝的必需权限（麦克风在前、摄像头在后）。只看这次实际申请了的项：
     * 可选权限（蓝牙）被拒不算；结果里没有的项（未申请，或申请被系统中断时回调空 map）也不算被拒。
     */
    fun deniedRequired(result: Map<String, Boolean>): List<String> =
        required(isVideo = true).filter { result[it] == false }

    /** 被拒必需权限的中文名：麦克风 / 摄像头 / 麦克风和摄像头；没有则返回空串 */
    fun displayName(denied: Collection<String>): String {
        val mic = Manifest.permission.RECORD_AUDIO in denied
        val camera = Manifest.permission.CAMERA in denied
        return when {
            mic && camera -> "麦克风和摄像头"
            mic -> "麦克风"
            camera -> "摄像头"
            else -> ""
        }
    }

    /** 必需权限被拒时的提示文案；没有被拒的必需权限（含只拒绝了蓝牙）时返回 null，不提示 */
    fun deniedMessage(denied: Collection<String>): String? {
        val name = displayName(denied)
        return if (name.isEmpty()) null else "缺少${name}权限，通话可能无法正常进行"
    }
}
