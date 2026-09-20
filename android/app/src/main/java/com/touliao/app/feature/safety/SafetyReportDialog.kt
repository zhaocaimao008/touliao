package com.touliao.app.feature.safety

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import com.touliao.app.core.network.toUserMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import retrofit2.Retrofit
import retrofit2.http.*
import javax.inject.Inject

@Serializable data class SafetyReportBody(val targetType: String, val targetId: String, val reason: String)
@Serializable data class SafetyReceipt(val id: String, val status: String)
@Serializable data class SafetyTicket(val id: String, val status: String, val reason: String, val resolution: String)
@Serializable data class SafetyTicketPage(val items: List<SafetyTicket>, val hasMore: Boolean)
interface SafetyApi {
    @POST("api/reports") suspend fun submit(@Body body: SafetyReportBody): SafetyReceipt
    @GET("api/reports") suspend fun list(@Query("offset") offset: Int, @Query("limit") limit: Int = 30): SafetyTicketPage
}
@HiltViewModel class SafetyReportViewModel @Inject constructor(retrofit: Retrofit) : ViewModel() {
    val api: SafetyApi = retrofit.create(SafetyApi::class.java)
}
private fun statusLabel(status: String) = mapOf("pending" to "待受理", "reviewing" to "处理中", "resolved" to "已处理", "dismissed" to "已驳回")[status] ?: status
@Composable fun SafetyReportButton(targetType: String = "support", targetId: String = "support", label: String = "举报与客服 / 我的工单") {
    var open by remember { mutableStateOf(false) }
    TextButton(onClick = { open = true }) { Text(label) }
    if (open) SafetyReportDialog(targetType, targetId, onClose = { open = false })
}
@Composable fun SafetyReportDialog(targetType: String, targetId: String, onClose: () -> Unit, viewModel: SafetyReportViewModel = hiltViewModel()) {
    var reason by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var receipt by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var items by remember { mutableStateOf<List<SafetyTicket>>(emptyList()) }
    var offset by remember { mutableStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load(start: Int) {
        try { val page = viewModel.api.list(start); items = page.items; offset = start; hasMore = page.hasMore; error = "" }
        catch (e: Exception) { error = e.toUserMessage("状态加载失败，请重试") }
    }
    LaunchedEffect(targetType, targetId) { load(0) }
    AlertDialog(onDismissRequest = onClose, title = { Text("举报与客服") },
        text = {
            Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
                Text("请说明问题，下方可查看回复。独立邮箱/电话和处理时限待运营方提供。")
                OutlinedTextField(value = reason, onValueChange = { if (it.length <= 1000) reason = it }, label = { Text("问题或举报理由") })
                TextButton(enabled = !busy && reason.isNotBlank(), onClick = {
                    if (!busy && reason.isNotBlank()) {
                        busy = true; error = ""
                        scope.launch {
                            try {
                                val result = viewModel.api.submit(SafetyReportBody(targetType, targetId, reason.trim()))
                                receipt = "工单 ${result.id}：${statusLabel(result.status)}"; reason = ""; load(0)
                            } catch(e: Exception) { error = e.toUserMessage("提交失败，请重试") }
                            finally { busy = false }
                        }
                    }
                }) { Text(if (busy) "提交中…" else "提交") }
                if (receipt.isNotEmpty()) Text(receipt)
                if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { scope.launch { load(offset) } }) { Text("刷新状态") }
                items.forEach { item -> Text("${item.id} · ${statusLabel(item.status)}\n${item.reason}\n${item.resolution.ifEmpty { "等待管理员处理" }}"); HorizontalDivider() }
                Row {
                    TextButton(enabled = offset > 0, onClick = { scope.launch { load((offset - 30).coerceAtLeast(0)) } }) { Text("上一页") }
                    TextButton(enabled = hasMore, onClick = { scope.launch { load(offset + 30) } }) { Text("下一页") }
                }
            }
        }, confirmButton = { TextButton(onClick = onClose) { Text("关闭") } })
}
