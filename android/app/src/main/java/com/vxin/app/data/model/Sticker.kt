package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 用户表情/贴纸 —— GET /api/stickers */
@Serializable
data class Sticker(
    val id: String,
    val url: String = "",
    val created_at: Long = 0,
)

@Serializable
data class StickerSendBody(val conversationId: String, val stickerId: String)

@Serializable
data class StickerCollectBody(val url: String)

/** 上传自定义表情响应 */
@Serializable
data class StickerUploadResponse(val id: String = "", val url: String = "")
