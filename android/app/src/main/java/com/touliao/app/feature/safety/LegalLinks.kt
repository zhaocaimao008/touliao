package com.touliao.app.feature.safety

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier

@Composable
fun LegalLinks() {
    var document by remember { mutableStateOf<String?>(null) }
    Row {
        TextButton(onClick = { document = LegalDocuments.privacy }) { Text("隐私政策") }
        TextButton(onClick = { document = LegalDocuments.terms }) { Text("用户协议") }
    }
    document?.let { text ->
        AlertDialog(onDismissRequest = { document = null },
            title = { Text("政策与协议") },
            text = { Text(text, Modifier.verticalScroll(rememberScrollState())) },
            confirmButton = { TextButton(onClick = { document = null }) { Text("关闭") } })
    }
}
