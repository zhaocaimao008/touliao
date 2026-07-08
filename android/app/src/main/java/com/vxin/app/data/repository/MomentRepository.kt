package com.vxin.app.data.repository

import com.vxin.app.data.api.MomentApi
import com.vxin.app.data.model.CreateMomentBody
import com.vxin.app.data.model.Moment
import com.vxin.app.data.model.MomentComment
import com.vxin.app.data.model.MomentCommentBody
import okhttp3.MultipartBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MomentRepository @Inject constructor(
    private val momentApi: MomentApi,
    socketManager: com.vxin.app.core.realtime.SocketManager,
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

    suspend fun deleteComment(commentId: String) = momentApi.deleteComment(commentId)

    suspend fun comments(id: String, limit: Int = 50, offset: Int = 0) =
        momentApi.comments(id, limit, offset)
}
