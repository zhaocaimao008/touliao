package com.touliao.app.core.update

import kotlinx.serialization.Serializable

/**
 * 远程版本清单，在服务器上放一份 vxin-android-version.json。
 * 服务器上需部署：https://touliao.cc/downloads/touliao-android-version.json
 */
@Serializable
data class AppVersionDto(
    val versionCode: Int,
    val versionName: String,
    val url: String,
    val notes: String,
    // APK 文件 SHA-256（小写十六进制），下载完成后校验用。这道校验和下面 versionCode
    // 单调递增校验一样，防的都是"内容被中间人/被攻破的更新host替换"这类场景，不是
    // 防"攻击者能同时伪造 json 和 APK 的完全自洽攻击"——后者唯一靠得住的独立防线是
    // ApkInstaller.isSignatureMatch()（校验的是发布签名私钥，不依赖 json/下载host的
    // 完整性），详见 AUDIT.md 相关章节的评估结论。
    val sha256: String,
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
        val sha256: String,
    ) : CheckResult()

    /** 检查失败（网络/解析/服务器错误） */
    data class Failed(val message: String) : CheckResult()
}
