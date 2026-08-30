package com.touliao.app.feature.auth

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.activity.compose.BackHandler
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.decode.SvgDecoder
import coil.request.ImageRequest
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.theme.VxinBrand
import com.touliao.app.ui.theme.VxinBrandLight
import com.touliao.app.ui.theme.VxinBrandDark
import com.touliao.app.ui.theme.VxinTeal
import com.touliao.app.ui.theme.VxinGreen
import com.touliao.app.ui.theme.VxinTextSecondary

@Composable
fun LoginScreen(
    onNavigateRegister: () -> Unit,
    onNavigateForgotPassword: () -> Unit = {},
    onSuccess: () -> Unit = {},
    onBack: (() -> Unit)? = null,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    androidx.compose.runtime.LaunchedEffect(state.loggedIn) { if (state.loggedIn) onSuccess() }
    var showServerConfig by remember { mutableStateOf(false) }
    // 添加账号入口：系统返回键/手势返回 = 返回上一页；普通登录页 onBack=null 时不拦截
    BackHandler(enabled = onBack != null) { onBack?.invoke() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (onBack != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Start,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
            }
            Spacer(Modifier.height(8.dp))
        }
        // 品牌 Logo 徽章：极光靛渐变圆角方 + 对话图标（对齐 Web 登录页）
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.xl))
                .background(Brush.linearGradient(listOf(VxinBrandLight, VxinBrandDark))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                TouliaoIcons.Chat,
                contentDescription = null,
                tint = androidx.compose.ui.graphics.Color.White,
                modifier = Modifier.size(38.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
        Text("投聊", fontSize = com.touliao.app.ui.theme.VxinTextSize.displayLg, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(6.dp))
        Text("安全 · 私密 · 畅聊", fontSize = com.touliao.app.ui.theme.VxinTextSize.base, color = VxinTextSecondary)
        Spacer(Modifier.height(40.dp))

        OutlinedTextField(
            value = state.phone,
            onValueChange = viewModel::onPhoneChange,
            label = { Text("手机号") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            modifier = Modifier.fillMaxWidth().testTag("login-phone-input"),
        )
        Spacer(Modifier.height(16.dp))
        var passwordVisible by remember { mutableStateOf(false) }
        OutlinedTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = { Text("密码") },
            singleLine = true,
            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = {
                TextButton(onClick = { passwordVisible = !passwordVisible }) {
                    Text(if (passwordVisible) "隐藏" else "显示", color = VxinTextSecondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm)
                }
            },
            modifier = Modifier.fillMaxWidth().testTag("login-password-input"),
        )

        if (state.captchaRequired) {
            Spacer(Modifier.height(16.dp))
            val context = LocalContext.current
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = state.captchaText,
                    onValueChange = viewModel::onCaptchaTextChange,
                    label = { Text("图形验证码") },
                    singleLine = true,
                    modifier = Modifier.weight(1f).testTag("login-captcha-input"),
                )
                Box(
                    modifier = Modifier
                        .size(width = 100.dp, height = 52.dp)
                        .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.md))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .testTag("login-captcha-refresh"),
                    contentAlignment = Alignment.Center,
                ) {
                    if (state.captchaSvgDataUrl.isNotEmpty()) {
                        // 验证码是后端下发的 SVG data URL：手动剥掉 base64 前缀解码成字节数组，
                        // 交给 SvgDecoder 渲染——Coil 默认不识别 data: scheme，直接传 ByteArray 最简单可靠。
                        val bytes = remember(state.captchaSvgDataUrl) {
                            runCatching {
                                android.util.Base64.decode(
                                    state.captchaSvgDataUrl.substringAfter("base64,"),
                                    android.util.Base64.DEFAULT,
                                )
                            }.getOrNull()
                        }
                        if (bytes != null) {
                            AsyncImage(
                                model = ImageRequest.Builder(context)
                                    .data(bytes)
                                    .decoderFactory(SvgDecoder.Factory())
                                    .build(),
                                contentDescription = "验证码，点击换一张",
                                modifier = Modifier.fillMaxSize()
                                    .clickable { viewModel.loadCaptcha() },
                            )
                        }
                    }
                }
            }
        }

        if (state.error != null) {
            Spacer(Modifier.height(12.dp))
            Text(
                text = state.error!!,
                color = MaterialTheme.colorScheme.error,
                fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2,
                modifier = Modifier.fillMaxWidth().testTag("auth-error-text"),
            )
        }

        Spacer(Modifier.height(28.dp))
        // 登录按钮：极光靛渐变实心（对齐 Web 主按钮），禁用态降透明
        Button(
            onClick = viewModel::submit,
            enabled = state.canSubmit,
            contentPadding = androidx.compose.foundation.layout.PaddingValues(),
            colors = ButtonDefaults.buttonColors(
                containerColor = androidx.compose.ui.graphics.Color.Transparent,
                disabledContainerColor = androidx.compose.ui.graphics.Color.Transparent,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp)
                .testTag("login-submit-btn"),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.pill))
                    .background(
                        if (state.canSubmit)
                            Brush.linearGradient(listOf(VxinBrandLight, VxinBrandDark))
                        else Brush.linearGradient(listOf(VxinTextSecondary, VxinTextSecondary))
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (state.loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = androidx.compose.ui.graphics.Color.White,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("登录", color = androidx.compose.ui.graphics.Color.White, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onNavigateRegister) {
            Text("注册账号", color = VxinGreen)
        }
        TextButton(onClick = onNavigateForgotPassword) {
            Text("忘记密码", color = VxinTextSecondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2)
        }

        TextButton(onClick = { showServerConfig = !showServerConfig }) {
            Text("切换服务器", color = VxinTextSecondary, fontSize = com.touliao.app.ui.theme.VxinTextSize.sm)
        }
        if (showServerConfig) {
            OutlinedTextField(
                value = state.serverUrl,
                onValueChange = viewModel::onServerUrlChange,
                label = { Text("服务器地址") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            TextButton(onClick = { viewModel.saveServerUrl(); showServerConfig = false }) {
                Text("保存", color = VxinGreen)
            }
        }
    }
}
