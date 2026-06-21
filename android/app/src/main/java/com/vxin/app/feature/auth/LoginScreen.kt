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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@Composable
fun LoginScreen(
    onNavigateRegister: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showServerConfig by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("v信", fontSize = 40.sp, fontWeight = FontWeight.Bold, color = VxinGreen)
        Spacer(Modifier.height(8.dp))
        Text("安全、高效的企业级通讯", fontSize = 14.sp, color = VxinTextSecondary)
        Spacer(Modifier.height(40.dp))

        OutlinedTextField(
            value = state.phone,
            onValueChange = viewModel::onPhoneChange,
            label = { Text("手机号") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = { Text("密码") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )

        if (state.error != null) {
            Spacer(Modifier.height(12.dp))
            Text(
                text = state.error!!,
                color = MaterialTheme.colorScheme.error,
                fontSize = 13.sp,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(Modifier.height(28.dp))
        Button(
            onClick = viewModel::submit,
            enabled = state.canSubmit,
            colors = ButtonDefaults.buttonColors(containerColor = VxinGreen),
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
        ) {
            if (state.loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp,
                )
            } else {
                Text("登录")
            }
        }

        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onNavigateRegister) {
            Text("注册账号", color = VxinGreen)
        }

        TextButton(onClick = { showServerConfig = !showServerConfig }) {
            Text("切换服务器", color = VxinTextSecondary, fontSize = 12.sp)
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
