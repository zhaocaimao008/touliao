package com.vxin.app.data.api

import com.vxin.app.data.model.AvatarResponse
import com.vxin.app.data.model.InviteInfo
import com.vxin.app.data.model.UpdateProfileRequest
import com.vxin.app.data.model.UpdateSettingsBody
import com.vxin.app.data.model.User
import com.vxin.app.data.model.UserSettings
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

    /** 读取个人设置 */
    @GET("api/users/me/settings")
    suspend fun settings(): UserSettings

    /** 更新个人设置（朋友圈可见天数 / 全局聊天背景等） */
    @PUT("api/users/me/settings")
    suspend fun updateSettings(@Body body: UpdateSettingsBody): UserSettings

    /** 上传头像（multipart 字段 avatar） */
    @Multipart
    @POST("api/users/avatar")
    suspend fun uploadAvatar(@Part avatar: MultipartBody.Part): AvatarResponse

    /** 我的二维码 PNG（需 Bearer，故走 authed Retrofit 取字节） */
    @Streaming
    @GET("api/users/me/qrcode")
    suspend fun qrcode(): ResponseBody

    /** 我的专属邀请码 + 邀请战绩 */
    @GET("api/users/me/invite")
    suspend fun myInvite(): InviteInfo
}
