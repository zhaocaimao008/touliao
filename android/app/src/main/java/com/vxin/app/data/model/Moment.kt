package com.vxin.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class MomentAuthor(val id: String = "", val username: String = "", val avatar: String = "")

@Serializable
data class MomentLike(val user_id: String = "", val username: String = "")

@Serializable
data class MomentComment(
    val id: String = "",
    val user_id: String = "",
    val content: String = "",
    val reply_to_user: String = "",
    val created_at: Long = 0,
    val username: String = "",
    val avatar: String = "",
)

/** 朋友圈动态（GET /api/moments，enrich 后结构） */
@Serializable
data class Moment(
    val id: String,
    val user_id: String = "",
    val content: String = "",
    val images: List<String> = emptyList(),
    val visibility: String = "all",
    val created_at: Long = 0,
    val author: MomentAuthor = MomentAuthor(),
    val likes: List<MomentLike> = emptyList(),
    val likeCount: Int = 0,
    val liked: Boolean = false,
    val comments: List<MomentComment> = emptyList(),
    val commentCount: Int = 0,
)

@Serializable
data class CreateMomentBody(val content: String, val images: List<String> = emptyList(), val visibility: String = "all")

@Serializable
data class MomentCommentBody(val content: String, val replyToUser: String = "")

@Serializable
data class MomentLikeResponse(val liked: Boolean = false, val likeCount: Int = 0)

@Serializable
data class MomentImagesResponse(val urls: List<String> = emptyList())

// GET /moments/:id/comments 分页响应（查看全部评论用）
@Serializable
data class CommentPage(
    val items: List<MomentComment> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
)
