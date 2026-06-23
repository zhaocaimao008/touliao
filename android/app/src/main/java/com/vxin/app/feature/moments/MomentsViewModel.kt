package com.vxin.app.feature.moments

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vxin.app.core.auth.SessionManager
import com.vxin.app.core.network.toUserMessage
import com.vxin.app.core.util.MediaUrlResolver
import com.vxin.app.data.model.Moment
import com.vxin.app.data.model.MomentComment
import com.vxin.app.data.repository.MomentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MomentsUiState(
    val loading: Boolean = true,
    val moments: List<Moment> = emptyList(),
    val loadingMore: Boolean = false,
    val reachedEnd: Boolean = false,
    val visibleDays: Int = 0,          // 朋友圈"最近 N 天可见"：0=全部
    val showSettings: Boolean = false,
    val error: String? = null,
)

private const val PAGE = 20

@HiltViewModel
class MomentsViewModel @Inject constructor(
    private val momentRepository: MomentRepository,
    private val profileRepository: com.vxin.app.data.repository.ProfileRepository,
    private val mediaUrlResolver: MediaUrlResolver,
    sessionManager: SessionManager,
) : ViewModel() {

    val myId: String = sessionManager.currentUser?.id.orEmpty()

    private val _uiState = MutableStateFlow(MomentsUiState())
    val uiState: StateFlow<MomentsUiState> = _uiState.asStateFlow()

    fun resolveUrl(url: String?): String? = mediaUrlResolver.resolve(url)

    init {
        refresh()
        loadSettings()
        viewModelScope.launch { momentRepository.momentEvents.collect { refresh() } }
    }

    // ── 朋友圈"最近 N 天可见" ──
    private fun loadSettings() {
        viewModelScope.launch {
            runCatching { profileRepository.settings() }
                .onSuccess { s -> _uiState.update { it.copy(visibleDays = s.momentsVisibleDays) } }
        }
    }

    fun openSettings() = _uiState.update { it.copy(showSettings = true) }
    fun dismissSettings() = _uiState.update { it.copy(showSettings = false) }

    fun setVisibleDays(days: Int) {
        _uiState.update { it.copy(visibleDays = days) }
        viewModelScope.launch {
            runCatching { profileRepository.setMomentsVisibleDays(days) }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("设置失败")) } }
        }
    }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { momentRepository.timeline(PAGE, 0) }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, moments = list, reachedEnd = list.size < PAGE) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.toUserMessage("加载失败")) } }
        }
    }

    fun loadMore() {
        val s = _uiState.value
        if (s.loadingMore || s.reachedEnd || s.loading) return
        _uiState.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            runCatching { momentRepository.timeline(PAGE, s.moments.size) }
                .onSuccess { list -> _uiState.update { it.copy(loadingMore = false, moments = it.moments + list, reachedEnd = list.size < PAGE) } }
                .onFailure { _uiState.update { it.copy(loadingMore = false) } }
        }
    }

    fun toggleLike(moment: Moment) {
        viewModelScope.launch {
            runCatching { momentRepository.like(moment.id) }
                .onSuccess { resp ->
                    _uiState.update { s ->
                        s.copy(moments = s.moments.map { m -> if (m.id == moment.id) m.copy(liked = resp.liked, likeCount = resp.likeCount) else m })
                    }
                    refreshOne(moment.id)
                }
        }
    }

    fun comment(moment: Moment, text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        viewModelScope.launch {
            runCatching { momentRepository.comment(moment.id, t) }
                .onSuccess { c ->
                    _uiState.update { s ->
                        s.copy(moments = s.moments.map { m -> if (m.id == moment.id) m.copy(comments = m.comments + c, commentCount = m.commentCount + 1) else m })
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("评论失败")) } }
        }
    }

    // 热门动态：timeline 只返回前 N 条评论，点「查看全部」时分页拉全量替换
    fun loadAllComments(moment: Moment) {
        viewModelScope.launch {
            val all = mutableListOf<MomentComment>()
            var offset = 0
            while (true) {
                val page = runCatching { momentRepository.comments(moment.id, 50, offset) }.getOrNull() ?: break
                all += page.items
                if (!page.hasMore || page.items.isEmpty()) break
                offset += 50
            }
            _uiState.update { s ->
                s.copy(moments = s.moments.map { m -> if (m.id == moment.id) m.copy(comments = all, commentCount = all.size) else m })
            }
        }
    }

    fun delete(moment: Moment) {
        viewModelScope.launch {
            runCatching { momentRepository.delete(moment.id) }
                .onSuccess { _uiState.update { s -> s.copy(moments = s.moments.filterNot { it.id == moment.id }) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.toUserMessage("删除失败")) } }
        }
    }

    /** 点赞后拉取该条最新（含点赞人列表），保持点赞名单一致 */
    private fun refreshOne(id: String) {
        // 简化：依赖本地乐观更新，这里不再请求详情（timeline 无单条接口）
    }
}
