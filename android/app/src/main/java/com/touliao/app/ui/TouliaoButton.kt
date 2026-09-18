package com.touliao.app.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Public name retained; the supplied design uses a flat, accessible primary button. */
@Composable
fun VxinGradientButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier,
                       enabled: Boolean = true, loading: Boolean = false) {
    Button(onClick = onClick, enabled = enabled && !loading,
        shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(16.dp, 12.dp),
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        if (loading) CircularProgressIndicator(Modifier.size(20.dp),
            color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
        else Text(text, style = MaterialTheme.typography.labelLarge)
    }
}
