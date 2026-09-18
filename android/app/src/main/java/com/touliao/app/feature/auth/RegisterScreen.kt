package com.touliao.app.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.Icon
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.theme.VxinBrand
import com.touliao.app.ui.theme.VxinBrandLight
import com.touliao.app.ui.theme.VxinBrandDark
import com.touliao.app.ui.theme.VxinGreen
import com.touliao.app.ui.theme.VxinTextSecondary

@Composable
fun RegisterScreen(
    onBack: () -> Unit,
    viewModel: RegisterViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // 品牌 Logo 徽章（与登录页一致）
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.lg))
                .background(MaterialTheme.colorScheme.primary),
            contentAlignment = Alignment.Center,
        ) {
            Icon(TouliaoIcons.Chat, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(32.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text("注册账号", fontSize = com.touliao.app.ui.theme.VxinTextSize.display, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(6.dp))
        Text(
            if (state.inviteRequired) "需要6位邀请码，可向已有用户或管理员获取" else "填写信息即可注册",
            fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2,
            color = VxinTextSecondary,
        )
        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = state.username,
            onValueChange = viewModel::onUsernameChange,
            label = { Text("昵称") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("register-username-input"),
        )
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = state.phone,
            onValueChange = viewModel::onPhoneChange,
            label = { Text("手机号") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            modifier = Modifier.fillMaxWidth().testTag("register-phone-input"),
        )
        if (state.inviteRequired) {
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = state.inviteCode,
                onValueChange = viewModel::onInviteCodeChange,
                label = { Text("邀请码（6位数字）") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth().testTag("register-invite-input"),
            )
        }
        Spacer(Modifier.height(16.dp))
        var passwordVisible by remember { mutableStateOf(false) }
        OutlinedTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = { Text("密码（至少8位，含字母和数字）") },
            singleLine = true,
            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = {
                TextButton(onClick = { passwordVisible = !passwordVisible }) {
                    Text(if (passwordVisible) "隐藏" else "显示", color = VxinTextSecondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm)
                }
            },
            modifier = Modifier.fillMaxWidth().testTag("register-password-input"),
        )

        if (state.error != null) {
            Spacer(Modifier.height(12.dp))
            Text(state.error!!, color = MaterialTheme.colorScheme.error, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2)
        }

        Spacer(Modifier.height(28.dp))
        // 注册按钮：极光靛渐变实心药丸（与登录页一致）
        com.touliao.app.ui.VxinGradientButton(
            text = "注册并登录", onClick = viewModel::submit,
            enabled = state.canSubmit, loading = state.loading,
            modifier = Modifier.testTag("register-submit-btn"),
        )
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onBack) {
            Text("返回登录", color = VxinTextSecondary)
        }
    }
}
