package com.vxin.app.feature.contacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.widget.Toast
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.vxin.app.data.model.SearchUser
import com.vxin.app.data.model.UserDetail
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.VxinGradientButton
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddFriendScreen(
    onBack: () -> Unit,
    onOpenMyQr: () -> Unit = {},
    viewModel: AddFriendViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    // 华为/OPPO 等无 GMS 设备不支持 GmsBarcodeScanning，需先检测可用性，
    // 否则 startScan() 会抛异常（无 GMS）或静默无反应。
    val gmsAvailable = remember {
        GoogleApiAvailability.getInstance()
            .isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }
    val scanner = remember(gmsAvailable) {
        if (gmsAvailable) {
            GmsBarcodeScanning.getClient(
                context,
                GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
            )
        } else null
    }

    // 扫码资料卡 Bottom Sheet
    if (state.scannedUserId != null) {
        ModalBottomSheet(
            onDismissRequest = { viewModel.dismissScannedUser() },
            sheetState = sheetState,
        ) {
            ScannedUserProfileSheet(
                detail = state.scannedUserDetail,
                loading = state.scannedUserLoading,
                alreadySent = state.scannedUserId in state.sentIds,
                onAddFriend = {
                    state.scannedUserId?.let { uid ->
                        scope.launch { sheetState.hide() }.invokeOnCompletion {
                            viewModel.sendRequestFromScanned(uid)
                        }
                    }
                },
                onDismiss = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion {
                        viewModel.dismissScannedUser()
                    }
                },
            )
        }
    }

    Scaffold(
        topBar = {
            androidx.compose.material3.TopAppBar(
                title = { Text("添加好友") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    onClick = {
                        val sc = scanner
                        if (sc == null) {
                            // 无 GMS（华为等）：扫码不可用，引导改用搜索用户名/手机号加好友
                            Toast.makeText(context, "当前设备不支持扫码，请在下方搜索用户名或手机号添加", Toast.LENGTH_LONG).show()
                        } else {
                            sc.startScan()
                                .addOnSuccessListener { barcode -> barcode.rawValue?.let { viewModel.addByQrPayload(it) } }
                                .addOnFailureListener { e ->
                                    Toast.makeText(context, "扫码失败：${e.message ?: "请重试或改用搜索"}", Toast.LENGTH_SHORT).show()
                                }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
                    modifier = Modifier.weight(1f),
                ) { Text("扫一扫") }
                OutlinedButton(onClick = onOpenMyQr, modifier = Modifier.weight(1f)) { Text("我的二维码") }
            }
            Spacer(Modifier.size(12.dp))

            OutlinedTextField(
                value = state.query,
                onValueChange = viewModel::onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("手机号 / v信号 / 用户名") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { viewModel.search() }),
            )
            Spacer(Modifier.size(8.dp))
            VxinGradientButton(
                text = "搜索",
                onClick = viewModel::search,
                enabled = state.query.isNotBlank() && !state.searching,
            )

            state.message?.let {
                Spacer(Modifier.size(8.dp))
                Text(it, color = VxinGreen, style = MaterialTheme.typography.bodySmall)
            }

            Spacer(Modifier.size(8.dp))
            Box(Modifier.fillMaxSize()) {
                when {
                    state.searching -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    state.searched && state.results.isEmpty() ->
                        com.vxin.app.ui.components.EmptyState(icon = "🔍", title = "未找到用户", subtitle = "换个手机号 / v信号试试", modifier = Modifier.align(Alignment.Center))
                    else -> LazyColumn(Modifier.fillMaxSize()) {
                        items(state.results, key = { it.id }) { user ->
                            SearchRow(user, sent = user.id in state.sentIds) { viewModel.sendRequest(user) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchRow(user: SearchUser, sent: Boolean, onAdd: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialAvatar(name = user.username.ifBlank { "?" }, size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(user.username.ifBlank { "未命名" }, style = MaterialTheme.typography.bodyLarge)
            if (user.wechat_id.isNotBlank()) {
                Text("v信号: ${user.wechat_id}", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
            }
        }
        Button(
            onClick = onAdd,
            enabled = !sent,
            colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
        ) { Text(if (sent) "已发送" else "添加") }
    }
}

/** 扫码后展示的用户资料卡（Bottom Sheet 内容） */
@Composable
private fun ScannedUserProfileSheet(
    detail: UserDetail?,
    loading: Boolean,
    alreadySent: Boolean,
    onAddFriend: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(8.dp))

        when {
            loading -> {
                Spacer(Modifier.height(48.dp))
                CircularProgressIndicator(color = VxinGreen)
                Spacer(Modifier.height(48.dp))
            }
            detail == null -> {
                Spacer(Modifier.height(32.dp))
                Text("加载失败", color = VxinTextSecondary)
                Spacer(Modifier.height(16.dp))
                OutlinedButton(onClick = onDismiss) { Text("关闭") }
                Spacer(Modifier.height(16.dp))
            }
            else -> {
                Spacer(Modifier.height(16.dp))
                InitialAvatar(name = detail.username.ifBlank { "?" }, size = 72.dp)
                Spacer(Modifier.height(12.dp))
                Text(
                    text = detail.username.ifBlank { "未命名" },
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                if (detail.wechat_id.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text("v信号: ${detail.wechat_id}", color = VxinTextSecondary, style = MaterialTheme.typography.bodySmall)
                }
                if (detail.bio.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(detail.bio, color = VxinTextSecondary, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(24.dp))
                HorizontalDivider()
                Spacer(Modifier.height(20.dp))

                when {
                    detail.isFriend -> {
                        Text("你们已经是好友了", color = VxinTextSecondary)
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("关闭") }
                    }
                    detail.hasPendingRequest || alreadySent -> {
                        Text("好友申请已发送，等待对方确认", color = VxinTextSecondary)
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("关闭") }
                    }
                    else -> {
                        Button(
                            onClick = onAddFriend,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
                        ) { Text("申请添加好友") }
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("取消") }
                    }
                }
            }
        }
    }
}
