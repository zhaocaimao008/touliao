package com.vxin.app.feature.wallet

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.data.model.WalletTransaction
import com.vxin.app.ui.components.EmptyState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(onBack: () -> Unit, viewModel: WalletViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("我的钱包") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.error != null && state.transactions.isEmpty() && state.balance == 0 ->
                    Text(state.error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("当前余额（金币）", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.size(8.dp))
                            Text("${state.balance}", fontSize = 40.sp, fontWeight = FontWeight.Bold, color = Color(0xFFFA9D3B))
                            Spacer(Modifier.size(6.dp))
                            Text("充值功能暂未开放，敬请期待", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                        HorizontalDivider()
                        Text("账单明细", Modifier.padding(16.dp, 12.dp, 16.dp, 4.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                    if (state.transactions.isEmpty()) {
                        item { Box(Modifier.fillMaxWidth().padding(top = 48.dp), contentAlignment = Alignment.Center) {
                            EmptyState(icon = "🧾", title = "暂无账单")
                        } }
                    } else {
                        items(state.transactions, key = { it.id }) { tx ->
                            TransactionRow(tx)
                            HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TransactionRow(tx: WalletTransaction) {
    val positive = tx.amount >= 0
    Row(Modifier.fillMaxWidth().padding(16.dp, 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(tx.memo.ifBlank { typeLabel(tx.type) }, style = MaterialTheme.typography.bodyLarge)
            Text(formatTime(tx.createdAt), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                (if (positive) "+" else "") + "${tx.amount}",
                color = if (positive) Color(0xFF07C160) else Color(0xFFFA5151),
                fontWeight = FontWeight.SemiBold,
            )
            Text("余额 ${tx.balanceAfter}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun typeLabel(type: String): String = when (type) {
    "red_packet" -> "红包"
    "red_packet_refund" -> "红包退款"
    "recharge" -> "充值"
    else -> type.ifBlank { "交易" }
}

private fun formatTime(epochSec: Long): String =
    if (epochSec <= 0) "" else SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(epochSec * 1000))
