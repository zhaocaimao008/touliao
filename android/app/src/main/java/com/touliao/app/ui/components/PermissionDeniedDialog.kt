package com.touliao.app.ui.components

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.touliao.app.ui.theme.LocalTouliaoPalette

/**
 * 权限永久拒绝引导对话框：用户勾选"不再询问"后，弹框引导去系统设置手动开启。
 */
@Composable
fun PermissionDeniedDialog(
    permissionName: String,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val palette = LocalTouliaoPalette.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("需要${permissionName}权限", color = palette.text) },
        text = {
            Text(
                "你已拒绝${permissionName}权限且勾选了不再询问，请前往系统设置手动开启，否则相关功能无法正常使用。",
                color = palette.readableMuted
            )
        },
        confirmButton = {
            TextButton(onClick = {
                onDismiss()
                openAppSettings(context)
            }) {
                Text("去设置", color = palette.primary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消", color = palette.readableMuted)
            }
        },
        containerColor = palette.surface,
    )
}

fun openAppSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.fromParts("package", context.packageName, null)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
}
