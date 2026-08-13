package com.touliao.app.data.repository

import com.touliao.app.data.api.StickerApi
import com.touliao.app.data.model.Message
import com.touliao.app.data.model.Sticker
import com.touliao.app.data.model.StickerCollectBody
import com.touliao.app.data.model.StickerSendBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class StickerRepository @Inject constructor(
    private val stickerApi: StickerApi,
) {
    suspend fun list(): List<Sticker> = stickerApi.list()

    suspend fun send(conversationId: String, stickerId: String): Message =
        stickerApi.send(StickerSendBody(conversationId, stickerId))

    suspend fun collect(url: String) = stickerApi.collect(StickerCollectBody(url))

    /** 上传自定义表情图片，返回新表情 URL。 */
    suspend fun upload(part: okhttp3.MultipartBody.Part): String = stickerApi.upload(part).url
}
