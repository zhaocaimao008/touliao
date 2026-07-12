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
import com.vxin.app.ui.VxinIcons
import com.vxin.app.ui.theme.VxinBrand
import com.vxin.app.ui.theme.VxinBrandLight
import com.vxin.app.ui.theme.VxinBrandDark
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@Composable
fun RegisterScreen(
    onBack: () -> Unit,
    viewModel: RegisterViewModel = hiltViewModel(),
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
        // 品牌 Logo 徽章（与登录页一致）
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
        Text("注册账号", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(6.dp))
        Text(
            if (state.inviteRequired) "需要6位邀请码，可向已有用户或管理员获取" else "填写信息即可注册",
            fontSize = 13.sp,
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
                    Text(if (passwordVisible) "隐藏" else "显示", color = VxinTextSecondary, fontSize = 12.sp)
                }
            },
            modifier = Modifier.fillMaxWidth().testTag("register-password-input"),
        )

        if (state.error != null) {
            Spacer(Modifier.height(12.dp))
            Text(state.error!!, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }

        Spacer(Modifier.height(28.dp))
        // 注册按钮：极光靛渐变实心药丸（与登录页一致）
        Button(
            onClick = viewModel::submit,
            enabled = state.canSubmit,
            contentPadding = androidx.compose.foundation.layout.PaddingValues(),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color.Transparent,
                disabledContainerColor = Color.Transparent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp)
                .testTag("register-submit-btn"),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .clip(RoundedCornerShape(25.dp))
                    .background(
                        if (state.canSubmit) Brush.linearGradient(listOf(VxinBrandLight, VxinBrandDark))
                        else Brush.linearGradient(listOf(VxinTextSecondary, VxinTextSecondary))
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (state.loading) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Text("注册并登录", color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onBack) {
            Text("返回登录", color = VxinTextSecondary)
        }
    }
}
