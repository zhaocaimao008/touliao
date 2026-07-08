package com.vxin.app.feature.moments

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import com.vxin.app.core.util.formatChatTime
import com.vxin.app.data.model.Moment
import com.vxin.app.data.model.MomentComment
import com.vxin.app.ui.components.InitialAvatar
import com.vxin.app.ui.theme.VxinGreen
import com.vxin.app.ui.theme.VxinTextSecondary

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.material.ExperimentalMaterialApi::class)
@Composable
fun MomentsScreen(
    onBack: (() -> Unit)? = null,   // null = 作为底部 Tab 使用（不显示返回箭头）
    onCompose: () -> Unit = {},
    viewModel: MomentsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    var commentingId by remember { mutableStateOf<String?>(null) }
    var commentText by remember { mutableStateOf("") }
    var replyTarget by remember { mutableStateOf<MomentComment?>(null) }  // 回复某条评论(null=普通评论)
    var deleteTarget by remember { mutableStateOf<Moment?>(null) }
    var deleteCommentTarget by remember { mutableStateOf<Pair<Moment, MomentComment>?>(null) }
    var gallery by remember { mutableStateOf<Pair<List<String>, Int>?>(null) }

    // 回到该页刷新（发布后）
    LaunchedEffect(Unit) { viewModel.refresh() }

    // 触底加载更多
    ReachedEndEffect(listState) { viewModel.loadMore() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("朋友圈") },
                navigationIcon = { onBack?.let { cb -> IconButton(onClick = cb) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") } } },
                actions = {
                    IconButton(onClick = { viewModel.openSettings() }) { Text("⚙️", fontSize = 16.sp) }
                    IconButton(onClick = onCompose) { Text("📷", fontSize = 18.sp) }
                },
            )
        },
    ) { padding ->
        val refreshing = state.loading && state.moments.isNotEmpty()
        val pullState = rememberPullRefreshState(refreshing = refreshing, onRefresh = { viewModel.refresh() })
        Box(Modifier.fillMaxSize().padding(padding).pullRefresh(pullState)) {
            when {
                state.loading && state.moments.isEmpty() -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.moments.isEmpty() -> com.vxin.app.ui.components.EmptyState(icon = "📷", title = "还没有朋友圈动态", subtitle = "分享生活，记录点滴", modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                    items(state.moments, key = { it.id }) { m ->
                        MomentCard(
                            moment = m,
                            isMine = m.user_id == viewModel.myId,
                            resolveUrl = viewModel::resolveUrl,
                            onLike = { viewModel.toggleLike(m) },
                            onComment = { commentingId = if (commentingId == m.id) null else m.id; commentText = ""; replyTarget = null },
                            onLongPress = { if (m.user_id == viewModel.myId) deleteTarget = m },
                            commenting = commentingId == m.id,
                            commentText = commentText,
                            onCommentTextChange = { commentText = it },
                            onSubmitComment = {
                                viewModel.comment(m, commentText, replyTarget?.user_id.orEmpty())
                                commentingId = null; commentText = ""; replyTarget = null
                            },
                            onViewAllComments = { viewModel.loadAllComments(m) },
                            onImageClick = { idx -> gallery = m.images to idx },
                            myId = viewModel.myId,
                            onLongPressComment = { c -> if (c.user_id == viewModel.myId) deleteCommentTarget = m to c },
                            replyTargetName = if (commentingId == m.id) replyTarget?.username.orEmpty() else "",
                            onReplyComment = { c ->
                                if (c.user_id != viewModel.myId) { replyTarget = c; commentingId = m.id }
                            },
                        )
                        HorizontalDivider(thickness = 6.dp, color = Color(0x11000000))
                    }
                    if (state.loadingMore) {
                        item { Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp)) } }
                    }
                }
            }
            state.error?.let {
                LaunchedEffect(it) { kotlinx.coroutines.delay(2500); viewModel.consumeError() }
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
            PullRefreshIndicator(refreshing, pullState, Modifier.align(Alignment.TopCenter))
        }
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("删除动态") },
            text = { Text("确认删除这条朋友圈？") },
            confirmButton = { TextButton(onClick = { viewModel.delete(target); deleteTarget = null }) { Text("删除", color = Color(0xFFFA5151)) } },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("取消") } },
        )
    }

    deleteCommentTarget?.let { (m, c) ->
        AlertDialog(
            onDismissRequest = { deleteCommentTarget = null },
            title = { Text("删除评论") },
            text = { Text("确认删除这条评论？") },
            confirmButton = { TextButton(onClick = { viewModel.deleteComment(m, c); deleteCommentTarget = null }) { Text("删除", color = Color(0xFFFA5151)) } },
            dismissButton = { TextButton(onClick = { deleteCommentTarget = null }) { Text("取消") } },
        )
    }

    gallery?.let { (imgs, start) ->
        ImageGallery(images = imgs.map { viewModel.resolveUrl(it) ?: it }, startIndex = start, onDismiss = { gallery = null })
    }

    if (state.showSettings) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissSettings() },
            title = { Text("朋友圈设置") },
            text = {
                Column {
                    Text("允许朋友查看朋友圈的范围", color = VxinTextSecondary, fontSize = 13.sp)
                    Spacer(Modifier.size(8.dp))
                    listOf(0 to "全部", 1 to "最近一天", 3 to "最近三天", 30 to "最近一个月").forEach { (d, label) ->
                        Row(
                            Modifier.fillMaxWidth().clickable { viewModel.setVisibleDays(d) }.padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(label, modifier = Modifier.weight(1f))
                            if (state.visibleDays == d) Text("✓", color = VxinGreen)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { viewModel.dismissSettings() }) { Text("完成", color = VxinGreen) } },
        )
    }
}

/** 全屏图片画廊：多图左右滑 + 双指缩放 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ImageGallery(images: List<String>, startIndex: Int, onDismiss: () -> Unit) {
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
        val pagerState = rememberPagerState(initialPage = startIndex.coerceIn(0, (images.size - 1).coerceAtLeast(0)), pageCount = { images.size })
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
                var scale by remember { mutableStateOf(1f) }
                Box(Modifier.fillMaxSize().clickable { onDismiss() }, contentAlignment = Alignment.Center) {
                    AsyncImage(
                        model = images[page],
                        contentDescription = "图片",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                            .graphicsLayer(scaleX = scale, scaleY = scale)
                            .pointerInput(Unit) { detectTransformGestures { _, _, zoom, _ -> scale = (scale * zoom).coerceIn(1f, 4f) } },
                    )
                }
            }
            Text(
                "${pagerState.currentPage + 1}/${images.size}",
                color = Color.White, fontSize = 13.sp,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 40.dp),
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MomentCard(
    moment: Moment,
    isMine: Boolean,
    resolveUrl: (String?) -> String?,
    onLike: () -> Unit,
    onComment: () -> Unit,
    onLongPress: () -> Unit,
    commenting: Boolean,
    commentText: String,
    onCommentTextChange: (String) -> Unit,
    onSubmitComment: () -> Unit,
    onViewAllComments: () -> Unit = {},
    onImageClick: (Int) -> Unit = {},
    myId: String = "",
    onLongPressComment: (MomentComment) -> Unit = {},
    replyTargetName: String = "",
    onReplyComment: (MomentComment) -> Unit = {},
) {
    Column(
        Modifier.fillMaxWidth()
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            InitialAvatar(name = moment.author.username.ifBlank { "?" }, size = 40.dp, avatarUrl = resolveUrl(moment.author.avatar))
            Spacer(Modifier.width(10.dp))
            Column {
                Text(moment.author.username.ifBlank { "未命名" }, color = VxinGreen, style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (moment.content.isNotBlank()) {
            Spacer(Modifier.size(6.dp))
            Text(moment.content, style = MaterialTheme.typography.bodyLarge)
        }
        if (moment.images.isNotEmpty()) {
            Spacer(Modifier.size(8.dp))
            ImageGrid(moment.images, resolveUrl, onImageClick)
        }
        Spacer(Modifier.size(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(formatChatTime(moment.created_at), color = VxinTextSecondary, fontSize = 11.sp, modifier = Modifier.weight(1f))
            TextButton(onClick = onLike) {
                Text(if (moment.liked) "❤️" else "🤍", fontSize = 14.sp)
                Spacer(Modifier.size(4.dp))
                Text(if (moment.liked) "已赞" else "赞", color = VxinGreen)
            }
            TextButton(onClick = onComment) {
                Text("💬", fontSize = 14.sp)
                Spacer(Modifier.size(4.dp))
                Text("评论", color = VxinGreen)
            }
        }
        // 点赞名单
        if (moment.likes.isNotEmpty()) {
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(Color(0x11000000)).padding(8.dp)) {
                Text("❤ " + moment.likes.joinToString("，") { it.username.ifBlank { "用户" } }, color = VxinGreen, fontSize = 13.sp)
            }
        }
        // 评论列表：点非自己的评论→回复该人；长按自己的评论→删除(对齐 web)
        moment.comments.forEach { c ->
            val mine = c.user_id == myId && myId.isNotEmpty()
            Row(
                Modifier.fillMaxWidth().padding(vertical = 2.dp)
                    .combinedClickable(
                        onClick = { if (!mine) onReplyComment(c) },
                        onLongClick = { if (mine) onLongPressComment(c) },
                    ),
            ) {
                Text("${c.username.ifBlank { "用户" }}", color = VxinGreen, fontSize = 13.sp)
                if (c.reply_to_username.isNotBlank()) {
                    Text(" 回复 ", fontSize = 13.sp, color = VxinTextSecondary)
                    Text(c.reply_to_username, color = VxinGreen, fontSize = 13.sp)
                }
                Text("：", color = VxinGreen, fontSize = 13.sp)
                Text(c.content, fontSize = 13.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
        }
        // 热门动态：timeline 只返回前 N 条，按需加载全部
        if (moment.commentCount > moment.comments.size) {
            TextButton(onClick = onViewAllComments) {
                Text("查看全部 ${moment.commentCount} 条评论", color = VxinGreen, fontSize = 13.sp)
            }
        }
        if (commenting) {
            Spacer(Modifier.size(6.dp))
            // 展开评论框时自动聚焦并弹出键盘
            val commentFocus = remember { androidx.compose.ui.focus.FocusRequester() }
            LaunchedEffect(Unit) { kotlinx.coroutines.delay(100); runCatching { commentFocus.requestFocus() } }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    commentText, onCommentTextChange,
                    Modifier.weight(1f).focusRequester(commentFocus),
                    placeholder = { Text(if (replyTargetName.isNotBlank()) "回复 $replyTargetName…" else "评论…") },
                    singleLine = true,
                )
                TextButton(onClick = onSubmitComment, enabled = commentText.isNotBlank()) { Text("发送", color = VxinGreen) }
            }
        }
    }
}

@Composable
private fun ImageGrid(images: List<String>, resolveUrl: (String?) -> String?, onImageClick: (Int) -> Unit) {
    // 单图：限制最大尺寸不铺满（对齐微信），保留原图比例
    if (images.size == 1) {
        AsyncImage(
            model = resolveUrl(images[0]),
            contentDescription = "图片",
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .widthIn(max = 220.dp)
                .heightIn(max = 280.dp)
                .clip(RoundedCornerShape(6.dp))
                .clickable { onImageClick(0) },
        )
        return
    }
    // 多图：3 列九宫格
    val cols = 3
    images.chunked(cols).forEachIndexed { rowIdx, rowImgs ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            rowImgs.forEachIndexed { i, img ->
                val index = rowIdx * cols + i
                SubcomposeAsyncImage(
                    model = resolveUrl(img),
                    contentDescription = "图片",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .weight(1f)
                        .aspectRatio(1f)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { onImageClick(index) },
                    // 加载中/失败灰底占位，避免九宫格空白闪烁
                    loading = { Box(Modifier.fillMaxSize().background(Color(0x11000000))) },
                    error = { Box(Modifier.fillMaxSize().background(Color(0x11000000))) },
                )
            }
            repeat(cols - rowImgs.size) { Spacer(Modifier.weight(1f)) }
        }
        Spacer(Modifier.size(4.dp))
    }
}

/** 监听列表滚动到末尾触发回调 */
@Composable
private fun ReachedEndEffect(listState: androidx.compose.foundation.lazy.LazyListState, onEnd: () -> Unit) {
    val reached by remember {
        androidx.compose.runtime.derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            val total = listState.layoutInfo.totalItemsCount
            total > 0 && last >= total - 2
        }
    }
    LaunchedEffect(reached) { if (reached) onEnd() }
}
