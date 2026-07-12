package com.vxin.app.feature.auth

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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.vxin.app.ui.VxinGradientButton
import com.vxin.app.ui.VxinIcons
import com.vxin.app.ui.theme.VxinBrand
import com.vxin.app.ui.theme.VxinBrandLight
import com.vxin.app.ui.theme.VxinBrandDark
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@Composable
fun ForgotPasswordScreen(
    onBack: () -> Unit,
    viewModel: ForgotPasswordViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // 品牌 Logo 徽章（与登录/注册页一致）
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(Brush.linearGradient(listOf(VxinBrandLight, VxinBrandDark))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(VxinIcons.Chat, contentDescription = null, tint = Color.White, modifier = Modifier.size(32.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text("忘记密码", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(6.dp))
        Text(
            "使用注册时的手机号和邀请码重置密码",
            fontSize = 13.sp,
            color = VxinTextSecondary,
        )
        Spacer(Modifier.height(28.dp))

        if (state.success) {
            Text("密码已重置，请返回登录", color = VxinBrand, fontSize = 15.sp)
            Spacer(Modifier.height(20.dp))
            VxinGradientButton(text = "返回登录", onClick = onBack)
            return@Column
        }

        OutlinedTextField(
            value = state.phone,
            onValueChange = viewModel::onPhoneChange,
            label = { Text("手机号") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(
            value = state.inviteCode,
            onValueChange = viewModel::onInviteCodeChange,
            label = { Text("邀请码（6位数字）") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(14.dp))
        var pwdVisible by remember { mutableStateOf(false) }
        OutlinedTextField(
            value = state.newPassword,
            onValueChange = viewModel::onNewPasswordChange,
            label = { Text("新密码（至少8位，含字母和数字）") },
            singleLine = true,
            visualTransformation = if (pwdVisible) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = {
                TextButton(onClick = { pwdVisible = !pwdVisible }) {
                    Text(if (pwdVisible) "隐藏" else "显示", color = VxinTextSecondary, fontSize = 12.sp)
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(14.dp))
        OutlinedTextField(
            value = state.confirmPassword,
            onValueChange = viewModel::onConfirmPasswordChange,
            label = { Text("确认新密码") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )

        if (state.error != null) {
            Spacer(Modifier.height(12.dp))
            Text(state.error!!, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }

        Spacer(Modifier.height(24.dp))
        VxinGradientButton(
            text = "重置密码",
            onClick = viewModel::submit,
            enabled = state.canSubmit,
            loading = state.loading,
        )
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onBack) {
            Text("返回登录", color = VxinTextSecondary)
        }
    }
}