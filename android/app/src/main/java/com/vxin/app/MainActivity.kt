package com.vxin.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.vxin.app.navigation.AppNavigation
import com.vxin.app.ui.theme.VxinTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            VxinTheme {
                // 让 Compose testTag 暴露为 UiAutomator 的 resource-id（Appium 定位前提）
                Surface(modifier = Modifier
                    .fillMaxSize()
                    .semantics { testTagsAsResourceId = true }) {
                    AppNavigation()
                }
            }
        }
    }
}
