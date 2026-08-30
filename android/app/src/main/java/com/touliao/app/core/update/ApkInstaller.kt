package com.touliao.app.core.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * APK 安装器。通过 FileProvider + ACTION_VIEW 启动系统 PackageInstaller。
 * 同签名覆盖安装，数据保留、无需先卸载。
 *
 * 需要在 AndroidManifest.xml 注册 FileProvider：
 *   <provider
 *       android:name="androidx.core.content.FileProvider"
 *       android:authorities="${applicationId}.fileprovider"
 *       android:exported="false"
 *       android:grantUriPermissions="true">
 *       <meta-data
 *           android:name="android.support.FILE_PROVIDER_PATHS"
 *           android:resource="@xml/file_paths" />
 *   </provider>
 */
@Singleton
class ApkInstaller @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    /**
     * 触发系统安装器安装 APK。
     * - Android 8+(Oreo) 需 [android.permission.REQUEST_INSTALL_PACKAGES]（已在 Manifest 声明）
     * - Android 10+(Q) 需额外处理，但 FileProvider+标准 Intent 就行
     * - 调用前最好检查 [canRequestPackageInstalls]（用户在系统弹窗也能拒绝）
     */
    /**
     * 触发系统安装器。返回详细结果，调用方必须据此给用户明确反馈。
     *
     * 2026-08-29 修复：旧实现返回纯 Boolean，调用方(UpdateViewModel)完全没检查返回值，
     * ReadyToInstall 状态在 UI 层还是"空 Composition 直接让弹窗消失"——任何一种失败
     * (签名不匹配/文件缺失/Intent 启动异常)在用户看来都是"下载完了，什么都没发生，
     * 也没有安装按钮"。最常见触发场景：v8.0.3 起投聊换了独立签名密钥(此前误用V信项目
     * 密钥)，凡是签名迁移前安装的旧版本用户，签名必然不一致，静默卡在这里。
     */
    sealed class InstallResult {
        object Launched : InstallResult()
        object FileMissing : InstallResult()
        object SignatureMismatch : InstallResult()
        /** 下载到的 APK 文件里真实的 versionCode 跟更新源 json 声明的不一致——见 install() 说明 */
        object VersionCodeMismatch : InstallResult()
        data class LaunchFailed(val reason: String) : InstallResult()
    }

    /**
     * @param apkFile 待安装的 APK
     * @param expectedVersionCode 更新源 json 声明的 versionCode（AppVersionDto.versionCode），
     *   用来跟 APK 文件本身 manifest 里真实的 versionCode 比对
     */
    fun install(apkFile: File, expectedVersionCode: Int): InstallResult {
        if (!apkFile.exists()) {
            Log.e(TAG, "APK 文件不存在: ${apkFile.absolutePath}")
            return InstallResult.FileMissing
        }

        // 安全加固：APK 文件真实携带的 versionCode 必须等于更新源 json 声明的那个数字。
        // SHA-256 只保证"下载到的文件内容没被中间人换掉"，不保证"json 吹的版本号是真的"——
        // 一个更隐蔽的攻击是：拿一份完全合法、真实签名过的**旧版**APK（连哈希都不用伪造，
        // 就是历史上真实发布过的文件），配一条声明"versionCode很高"的假json条目，SHA-256
        // 和签名校验全部通过（文件本身货真价实），却让用户装回一个旧版本（可能带着已修复
        // 的漏洞）。这道校验专门堵这个口子，比对的是APK文件自己manifest里的versionCode，
        // 不依赖json的自述。
        val actualVersionCode = getApkVersionCode(apkFile)
        if (actualVersionCode == null || actualVersionCode != expectedVersionCode) {
            Log.e(TAG, "APK内版本号与更新源声明不一致，拒绝安装: apk内=$actualVersionCode 声明=$expectedVersionCode")
            apkFile.delete() // 不留可疑文件在磁盘上，防止被其它路径（文件管理器等）单独打开安装
            return InstallResult.VersionCodeMismatch
        }

        // 安全加固：安装前校验 APK 签名与当前已安装应用一致，防止更新服务器被入侵/
        // 中间人劫持后投递恶意 APK（任意代码执行入口）。不一致直接拒绝安装，
        // 但必须告诉用户为什么(签名变更需先卸载旧版)，不能静默失败。
        if (!isSignatureMatch(apkFile)) {
            Log.e(TAG, "APK 签名与当前应用不一致，拒绝安装: ${apkFile.absolutePath}")
            apkFile.delete() // 同上：不留下已被判定不可信的文件
            return InstallResult.SignatureMismatch
        }

        val apkUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile,
        )

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            }
        }

        return try {
            Log.i(TAG, "启动安装器: $apkUri")
            context.startActivity(intent)
            InstallResult.Launched
        } catch (e: Exception) {
            Log.e(TAG, "启动安装器失败: ${e.message}")
            InstallResult.LaunchFailed(e.message ?: "未知错误")
        }
    }

    /** 打开系统「安装未知应用」授权页，指向本 App。授权后用户可再次点更新完成安装。 */
    fun openInstallPermissionSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        runCatching {
            context.startActivity(
                Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    .setData(Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }.onFailure {
            runCatching {
                context.startActivity(
                    Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
        }
    }

    /**
     * 检查是否可以请求安装未知来源应用（Android 8+ 需要）。
     * 若返回 false，用户需前往「设置 → 安装未知应用」授权本 App。
     */
    fun canRequestPackageInstalls(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    /**
     * 校验待安装 APK 的签名证书与当前已安装应用是否一致。
     * - Android 9+ 用 signingInfo（兼容 v1/v2/v3 签名）
     * - 旧版本用 GET_SIGNATURES
     * 不一致返回 false（拒绝安装），防止更新通道被攻破后投递恶意包。
     */
    fun isSignatureMatch(apkFile: File): Boolean {
        return try {
            val pm = context.packageManager
            val apkSig = getApkSignatures(pm, apkFile) ?: return false
            val installedSig = getInstalledSignatures(pm) ?: return false
            // 双方签名指纹集合完全一致才算匹配（多签名场景全量比对）
            val apkSet = apkSig.map { sha256Hex(it) }.toSet()
            val instSet = installedSig.map { sha256Hex(it) }.toSet()
            val matched = apkSet.isNotEmpty() && apkSet == instSet
            if (!matched) Log.w(TAG, "签名不匹配: apk=${apkSet} installed=${instSet}")
            matched
        } catch (e: Exception) {
            Log.e(TAG, "签名校验异常: ${e.message}", e)
            false // 校验失败一律拒绝，安全优先
        }
    }

    /** 读取待安装 APK 文件 manifest 里真实的 versionCode（不是更新源 json 声明的那个）。 */
    private fun getApkVersionCode(apkFile: File): Int? {
        return try {
            val pm = context.packageManager
            val info: PackageInfo = pm.getPackageArchiveInfo(apkFile.absolutePath, 0) ?: return null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode.toInt()
            } else {
                @Suppress("DEPRECATION")
                info.versionCode
            }
        } catch (e: Exception) {
            Log.e(TAG, "读取APK版本号失败: ${e.message}", e)
            null
        }
    }

    private fun getApkSignatures(pm: PackageManager, apkFile: File): List<Signature>? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info: PackageInfo = pm.getPackageArchiveInfo(
                apkFile.absolutePath,
                PackageManager.GET_SIGNING_CERTIFICATES,
            ) ?: return null
            info.signingInfo?.apkContentsSigners?.toList() ?: return null
        } else {
            @Suppress("DEPRECATION")
            val info: PackageInfo = pm.getPackageArchiveInfo(
                apkFile.absolutePath,
                PackageManager.GET_SIGNATURES,
            ) ?: return null
            @Suppress("DEPRECATION")
            info.signatures?.toList() ?: return null
        }
    }

    private fun getInstalledSignatures(pm: PackageManager): List<Signature>? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info: PackageInfo = pm.getPackageInfo(
                context.packageName,
                PackageManager.GET_SIGNING_CERTIFICATES,
            ) ?: return null
            info.signingInfo?.apkContentsSigners?.toList() ?: return null
        } else {
            @Suppress("DEPRECATION")
            val info: PackageInfo = pm.getPackageInfo(
                context.packageName,
                PackageManager.GET_SIGNATURES,
            ) ?: return null
            @Suppress("DEPRECATION")
            info.signatures?.toList() ?: return null
        }
    }

    private fun sha256Hex(sig: Signature): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(sig.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val TAG = "ApkInstaller"
    }
}
