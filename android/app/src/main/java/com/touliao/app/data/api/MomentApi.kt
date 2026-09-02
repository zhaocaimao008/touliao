package com.touliao.app.data.api

import com.touliao.app.data.model.CommentPage
import com.touliao.app.data.model.CreateMomentBody
import com.touliao.app.data.model.Moment
import com.touliao.app.data.model.MomentComment
import com.touliao.app.data.model.MomentCommentBody
import com.touliao.app.data.model.MomentImagesResponse
import com.touliao.app.data.model.MomentLikeResponse
import com.touliao.app.data.model.MomentNotifPage
import com.touliao.app.data.model.UnreadCountResponse
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface MomentApi {

    @GET("api/moments")
    suspend fun timeline(@Query("limit") limit: Int = 20, @Query("offset") offset: Int = 0): List<Moment>

    @POST("api/moments")
    suspend fun create(@Body body: CreateMomentBody): Moment

    @Multipart
    @POST("api/moments/images")
    suspend fun uploadImages(@Part images: List<MultipartBody.Part>): MomentImagesResponse

    @POST("api/moments/{id}/like")
    suspend fun like(@Path("id") id: String): MomentLikeResponse

    @POST("api/moments/{id}/comment")
    suspend fun comment(@Path("id") id: String, @Body body: MomentCommentBody): MomentComment

    @GET("api/moments/{id}/comments")
    suspend fun comments(@Path("id") id: String, @Query("limit") limit: Int = 50, @Query("offset") offset: Int = 0): CommentPage

    @DELETE("api/moments/{id}")
    suspend fun delete(@Path("id") id: String)

    @POST("api/moments/{id}/report")
    suspend fun report(@Path("id") id: String)

    @DELETE("api/moments/comments/{commentId}")
    suspend fun deleteComment(@Path("commentId") commentId: String)

    // ── 互动通知 ──
    @GET("api/moments/notifications")
    suspend fun notifications(@Query("limit") limit: Int = 30, @Query("offset") offset: Int = 0): MomentNotifPage

    @GET("api/moments/notifications/unread-count")
    suspend fun notifUnreadCount(): UnreadCountResponse

    @POST("api/moments/notifications/read")
    suspend fun notifMarkRead()
}
