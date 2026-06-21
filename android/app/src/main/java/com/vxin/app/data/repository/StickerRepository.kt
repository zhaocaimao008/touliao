package com.vxin.app.data.repository

import com.vxin.app.data.api.StickerApi
import com.vxin.app.data.model.Message
import com.vxin.app.data.model.Sticker
import com.vxin.app.data.model.StickerCollectBody
import com.vxin.app.data.model.StickerSendBody
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
}
