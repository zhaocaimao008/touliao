package com.vxin.app.data.api

import com.vxin.app.data.model.CommentPage
import com.vxin.app.data.model.CreateMomentBody
import com.vxin.app.data.model.Moment
import com.vxin.app.data.model.MomentComment
import com.vxin.app.data.model.MomentCommentBody
import com.vxin.app.data.model.MomentImagesResponse
import com.vxin.app.data.model.MomentLikeResponse
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

    @DELETE("api/moments/comments/{commentId}")
    suspend fun deleteComment(@Path("commentId") commentId: String)
}
