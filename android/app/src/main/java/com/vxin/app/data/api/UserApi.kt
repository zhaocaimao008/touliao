package com.vxin.app.data.api

import com.vxin.app.data.model.AvatarResponse
import com.vxin.app.data.model.UpdateProfileRequest
import com.vxin.app.data.model.User
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Streaming

interface UserApi {

    /** 更新昵称/签名 */
    @PUT("api/users/profile")
    suspend fun updateProfile(@Body body: UpdateProfileRequest): User

    /** 上传头像（multipart 字段 avatar） */
    @Multipart
    @POST("api/users/avatar")
    suspend fun uploadAvatar(@Part avatar: MultipartBody.Part): AvatarResponse

    /** 我的二维码 PNG（需 Bearer，故走 authed Retrofit 取字节） */
    @Streaming
    @GET("api/users/me/qrcode")
    suspend fun qrcode(): ResponseBody
}
