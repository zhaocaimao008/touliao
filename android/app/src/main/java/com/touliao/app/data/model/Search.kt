package com.touliao.app.data.model

import kotlinx.serialization.Serializable

/** 全局搜索结果项 —— GET /api/messages/search */
@Serializable
data class SearchResult(
    val id: String,
    val conversation_id: String,
    val sender_id: String = "",
    val type: String = "text",          // text | image | voice | video | file | contact_card | red_packet | transfer | merged | call ...
    val content: String = "",
    val created_at: Long = 0,
    val senderName: String = "",
    val senderAvatar: String = "",
    val convName: String = "",
    val convType: String = "private",
    val otherUser: ConversationOtherUser? = null,  // 私聊对方（后端 search 私聊项返回；群聊为 null）
)

@Serializable
data class SearchResponse(
    val results: List<SearchResult> = emptyList(),
    val total: Int = 0,
)
