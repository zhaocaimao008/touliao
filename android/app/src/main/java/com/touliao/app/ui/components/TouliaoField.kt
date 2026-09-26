package com.touliao.app.ui.components

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import com.touliao.app.ui.theme.TouliaoMetrics

/** v4：填充式输入框（无描边、无下划线，14dp 圆角），与 Web/iOS 一致；错误态用错误色底。
 * Native editing, IME, selection and semantics stay with Material's TextField.
 * This adapter owns the shared shape/typography/minimum size and all native
 * default/focused/filled/error/disabled/readOnly states. Callers own validation.
 */
@Composable
fun TouliaoField(
    value: String, onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier, enabled: Boolean = true, readOnly: Boolean = false,
    label: @Composable (() -> Unit)? = null, placeholder: @Composable (() -> Unit)? = null,
    leadingIcon: @Composable (() -> Unit)? = null, trailingIcon: @Composable (() -> Unit)? = null,
    supportingText: @Composable (() -> Unit)? = null, isError: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = false, maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    minLines: Int = 1, textStyle: TextStyle = MaterialTheme.typography.bodyLarge,
) {
    val scheme = MaterialTheme.colorScheme
    TextField(value = value, onValueChange = onValueChange,
        modifier = modifier.heightIn(min = TouliaoMetrics.fieldHeight),
        enabled = enabled, readOnly = readOnly, label = label, placeholder = placeholder,
        leadingIcon = leadingIcon, trailingIcon = trailingIcon, supportingText = supportingText,
        isError = isError, visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
        singleLine = singleLine, maxLines = maxLines, minLines = minLines,
        textStyle = textStyle, shape = RoundedCornerShape(TouliaoMetrics.radiusControl),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = scheme.surfaceVariant,
            unfocusedContainerColor = scheme.surfaceVariant,
            disabledContainerColor = scheme.surfaceVariant.copy(alpha = 0.5f),
            errorContainerColor = scheme.errorContainer,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent,
            errorIndicatorColor = Color.Transparent,
        ))
}
