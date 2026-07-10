package com.vxin.app.core.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
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
    fun install(apkFile: File) {
        if (!apkFile.exists()) {
            Log.e(TAG, "APK 文件不存在: ${apkFile.absolutePath}")
            return
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

            // Android 14+(34) 要求，但加无害
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            }
        }

        Log.i(TAG, "启动安装器: $apkUri")
        context.startActivity(intent)
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

    companion object {
        private const val TAG = "ApkInstaller"
    }
}
