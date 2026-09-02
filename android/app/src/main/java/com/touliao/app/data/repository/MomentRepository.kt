package com.touliao.app.data.repository

import com.touliao.app.data.api.MomentApi
import com.touliao.app.data.model.CreateMomentBody
import com.touliao.app.data.model.Moment
import com.touliao.app.data.model.MomentComment
import com.touliao.app.data.model.MomentCommentBody
import okhttp3.MultipartBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MomentRepository @Inject constructor(
    private val momentApi: MomentApi,
    socketManager: com.touliao.app.core.realtime.SocketManager,
) {
    /** 朋友圈实时事件（新动态/点赞/评论） */
    val momentEvents = socketManager.momentEvents

    suspend fun timeline(limit: Int = 20, offset: Int = 0): List<Moment> = momentApi.timeline(limit, offset)

    suspend fun create(
        content: String,
        images: List<String>,
        visibility: String,
        visibleTo: List<String> = emptyList(),
    ): Moment =
        momentApi.create(CreateMomentBody(content, images, visibility, visibleTo))

    suspend fun uploadImages(parts: List<MultipartBody.Part>): List<String> =
        momentApi.uploadImages(parts).urls

    suspend fun like(id: String) = momentApi.like(id)

    suspend fun comment(id: String, content: String, replyToUser: String = ""): MomentComment =
        momentApi.comment(id, MomentCommentBody(content, replyToUser))

    suspend fun delete(id: String) = momentApi.delete(id)

    suspend fun report(id: String) = momentApi.report(id)

    suspend fun deleteComment(commentId: String) = momentApi.deleteComment(commentId)

    suspend fun comments(id: String, limit: Int = 50, offset: Int = 0) =
        momentApi.comments(id, limit, offset)

    // ── 互动通知 ──
    suspend fun notifications(limit: Int = 30, offset: Int = 0) = momentApi.notifications(limit, offset)
    suspend fun notifUnreadCount(): Int = momentApi.notifUnreadCount().count
    suspend fun markNotificationsRead() = momentApi.notifMarkRead()
}
