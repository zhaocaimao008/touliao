package com.touliao.app.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.theme.VxinBrandDark
import com.touliao.app.ui.theme.VxinBrandLight
import com.touliao.app.ui.theme.VxinTextSecondary

/**
 * 找回密码：与 Web 对齐（P1-01）——原"手机号+6位邀请码"自助重置流程存在账号接管风险
 * （邀请码空间小、易被枚举），后端 auth.service.js resetPassword() 已硬编码禁用，
 * 无论提交什么参数一律返回"密码重置功能暂不可用"。三端此前不一致：Web 已改成纯提示页，
 * Android/iOS 却还留着完整表单——用户填完提交必然收到统一拒绝错误，是死 UI。这里同步收紧。
 */
@Composable
fun ForgotPasswordScreen(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(com.touliao.app.ui.theme.VxinRadius.lg))
                .background(Brush.linearGradient(listOf(VxinBrandLight, VxinBrandDark))),
            contentAlignment = Alignment.Center,
        ) {
            Icon(TouliaoIcons.Chat, contentDescription = null, tint = Color.White, modifier = Modifier.size(32.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text("忘记密码", fontSize = com.touliao.app.ui.theme.VxinTextSize.display, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(6.dp))
        Text("密码重置服务暂时不可用", fontSize = com.touliao.app.ui.theme.VxinTextSize.sm2, color = VxinTextSecondary)
        Spacer(Modifier.height(28.dp))
        Text(
            "为保护账号安全，当前不支持在线重置密码。\n请联系管理员协助处理。",
            fontSize = com.touliao.app.ui.theme.VxinTextSize.md,
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        TextButton(onClick = onBack) {
            Text("返回登录", color = VxinTextSecondary)
        }
    }
}
