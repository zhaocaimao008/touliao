package com.touliao.app.feature.discover

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.touliao.app.core.realtime.SocketManager
import com.touliao.app.data.api.MomentApi
import com.touliao.app.ui.TouliaoIcons
import com.touliao.app.ui.components.TouliaoSettingDivider
import com.touliao.app.ui.components.TouliaoSettingRow
import com.touliao.app.ui.components.TouliaoSettingSection
import com.touliao.app.ui.theme.TouliaoMetrics
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 朋友圈互动未读数：底部「发现」标签红点与发现页朋友圈入口共用。朋友圈关闭时接口 403，按 0 处理。 */
@HiltViewModel
class DiscoverViewModel @Inject constructor(
    private val momentApi: MomentApi,
    socketManager: SocketManager,
) : ViewModel() {
    private val _momentUnread = MutableStateFlow(0)
    val momentUnread: StateFlow<Int> = _momentUnread.asStateFlow()

    init {
        refresh()
        viewModelScope.launch { socketManager.momentEvents.collect { refresh() } }
    }

    fun refresh() {
        viewModelScope.launch {
            _momentUnread.value = runCatching { momentApi.notifUnreadCount().count }.getOrDefault(0)
        }
    }
}

/** 「发现」页：朋友圈 / 通话记录 / 收藏 入口（朋友圈、收藏受后台开关控制）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiscoverScreen(
    showMoments: Boolean,
    showFavorites: Boolean,
    momentUnread: Int,
    onResume: () -> Unit,
    onOpenMoments: () -> Unit,
    onOpenCallHistory: () -> Unit,
    onOpenFavorites: () -> Unit,
) {
    // 从朋友圈返回时刷新红点（进入互动消息后已读）
    LaunchedEffect(Unit) { onResume() }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("发现", style = MaterialTheme.typography.headlineMedium) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = TouliaoMetrics.space4)) {
            TouliaoSettingSection {
                var first = true
                if (showMoments) {
                    val unreadBadge: (@Composable () -> Unit)? = if (momentUnread > 0) {
                        { Badge { Text(if (momentUnread > 99) "99+" else momentUnread.toString()) } }
                    } else {
                        null
                    }
                    TouliaoSettingRow(
                        icon = TouliaoIcons.Discover,
                        title = "朋友圈",
                        modifier = Modifier.testTag("discover-moments"),
                        trailingContent = unreadBadge,
                        onClick = onOpenMoments,
                    )
                    first = false
                }
                if (!first) TouliaoSettingDivider()
                TouliaoSettingRow(
                    icon = TouliaoIcons.PhoneCall,
                    title = "通话记录",
                    modifier = Modifier.testTag("discover-calls"),
                    onClick = onOpenCallHistory,
                )
                if (showFavorites) {
                    TouliaoSettingDivider()
                    TouliaoSettingRow(
                        icon = TouliaoIcons.Favorite,
                        title = "收藏",
                        modifier = Modifier.testTag("discover-favorites"),
                        onClick = onOpenFavorites,
                    )
                }
            }
        }
    }
}
