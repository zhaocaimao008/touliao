package com.vxin.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class CollectionExtra(
    val file_url: String = "",
    val source_msg_id: String = "",
)

/** 收藏项（GET /api/users/me/collections） */
@Serializable
data class Collection(
    val id: String,
    val type: String = "text",      // text | image | file | video
    val content: String = "",
    val extra: CollectionExtra = CollectionExtra(),
    val created_at: Long = 0,
)

/** 收藏搜索分页响应（GET /api/users/me/collections/search） */
@Serializable
data class CollectionPage(
    val items: List<Collection> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
)
