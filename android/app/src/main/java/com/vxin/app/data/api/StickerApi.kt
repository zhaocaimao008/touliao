package com.vxin.app.data.api

import com.vxin.app.data.model.Message
import com.vxin.app.data.model.Sticker
import com.vxin.app.data.model.StickerCollectBody
import com.vxin.app.data.model.StickerSendBody
import com.vxin.app.data.model.StickerUploadResponse
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part

interface StickerApi {

    @GET("api/stickers")
    suspend fun list(): List<Sticker>

    /** 上传自定义表情图片（字段名 image），返回 { id, url } */
    @Multipart
    @POST("api/stickers/upload")
    suspend fun upload(@Part image: MultipartBody.Part): StickerUploadResponse

    /** 发送表情(服务端建 image 消息并广播),返回该消息 */
    @POST("api/stickers/send")
    suspend fun send(@Body body: StickerSendBody): Message

    /** 收藏一张已有图片为表情 */
    @POST("api/stickers/collect")
    suspend fun collect(@Body body: StickerCollectBody)
}
