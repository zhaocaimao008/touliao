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
     * 触发系统安装器。返回是否成功启动安装 Intent。
     * - 若 Android 8+ 未授予「安装未知应用」权限 → 返回 false（调用方应引导去授权）。
     * - 旧实现直接 startActivity 而不校验权限：未授权时被系统静默拦截，
     *   表现为「点了更新没反应」——这是本次修复的核心。
     */
    fun install(apkFile: File): Boolean {
        if (!apkFile.exists()) {
            Log.e(TAG, "APK 文件不存在: ${apkFile.absolutePath}")
            return false
        }
        if (!canRequestPackageInstalls()) {
            Log.w(TAG, "未授予安装未知应用权限，无法启动安装")
            return false
        }
        // 安全加固：安装前校验 APK 签名与当前已安装应用一致，防止更新服务器被入侵/
        // 中间人劫持后投递恶意 APK（任意代码执行入口）。不一致直接拒绝安装。
        if (!isSignatureMatch(apkFile)) {
            Log.e(TAG, "APK 签名与当前应用不一致，拒绝安装: ${apkFile.absolutePath}")
            return false
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
            true
        } catch (e: Exception) {
            Log.e(TAG, "启动安装器失败: ${e.message}")
            false
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
