package com.vxin.app.core.update

import kotlinx.serialization.Serializable

/**
 * 远程版本清单，在服务器上放一份 vxin-android-version.json。
 * 服务器上需部署：https://dipsin.com/downloads/vxin-android-version.json
 */
@Serializable
data class AppVersionDto(
    val versionCode: Int,
    val versionName: String,
    val url: String,
    val notes: String,
)

/**
 * 检查结果，给 ViewModel / UI 消费。
 */
sealed class CheckResult {
    /** 已经是最新版 */
    data object UpToDate : CheckResult()

    /** 有新版可用 */
    data class Available(
        val versionCode: Int,
        val versionName: String,
        val url: String,
        val notes: String,
    ) : CheckResult()

    /** 检查失败（网络/解析/服务器错误） */
    data class Failed(val message: String) : CheckResult()
}
