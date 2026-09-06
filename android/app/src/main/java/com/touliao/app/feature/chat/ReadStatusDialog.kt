package com.touliao.app.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.touliao.app.ui.components.InitialAvatar
import com.touliao.app.ui.theme.VxinGreen
import com.touliao.app.ui.theme.VxinTextSecondary

/**
 * 已读状态详情弹窗（F4b，对齐 Web ReadStatusModal 消费同一 read-states 响应形状）：
 * 私聊=「对方已读/未读」；群聊=「已读 N/M」+ 可展开已读成员名单。
 */
@Composable
fun ReadStatusDialog(
    detail: ReadStatusDetail,
    model: ReadStatusModel,
    avatarUrl: (String?) -> String?,
    onRetry: () -> Unit,
    onClose: () -> Unit,
) {
    var expanded by remember(detail.messageId) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("已读状态") },
        text = {
            when {
                detail.loading -> Text("查询中…", color = VxinTextSecondary)
                detail.error -> Column {
                    Text("加载失败，请重试")
                    TextButton(onClick = onRetry) { Text("重试") }
                }
                !model.isGroup -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (model.peerRead) "✓✓" else "✓",
                        color = if (model.peerRead) VxinGreen else VxinTextSecondary,
                    )
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(if (model.peerRead) "对方已读" else "对方未读")
                        if (model.peerName.isNotBlank()) {
                            Text(model.peerName, color = VxinTextSecondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2)
                        }
                    }
                }
                else -> Column {
                    // 已读 N/M：点击展开/收起已读成员名单（无已读时不可展开）
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable(enabled = model.readCount > 0) { expanded = !expanded }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (model.recipientCount > 0) "已读 ${model.readCount}/${model.recipientCount}"
                            else "已读 ${model.readCount}",
                            color = if (model.readCount > 0) VxinGreen else VxinTextSecondary,
                            modifier = Modifier.weight(1f),
                        )
                        if (model.readCount > 0) {
                            Text(if (expanded) "收起" else "展开", color = VxinGreen)
                        }
                    }
                    if (model.readCount == 0) {
                        Text("暂无群成员已读", color = VxinTextSecondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2)
                    }
                    if (expanded && model.readers.isNotEmpty()) {
                        HorizontalDivider(Modifier.padding(vertical = 4.dp), thickness = 0.5.dp)
                        LazyColumn(Modifier.heightIn(max = 260.dp)) {
                            items(model.readers, key = { it.id }) { reader ->
                                Row(
                                    Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    InitialAvatar(
                                        name = reader.name.ifBlank { "?" },
                                        size = 36.dp,
                                        avatarUrl = avatarUrl(reader.avatar),
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Text(reader.name.ifBlank { "群成员" })
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onClose) { Text("关闭") }
        },
    )
}
