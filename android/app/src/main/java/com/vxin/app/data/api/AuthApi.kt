package com.vxin.app.data.api

import com.vxin.app.data.model.AuthResponse
import com.vxin.app.data.model.LoginRequest
import com.vxin.app.data.model.RegisterRequest
import com.vxin.app.data.model.User
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT

interface AuthApi {

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponse

    @POST("api/auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponse

    /** 校验/恢复会话；需 Bearer。返回当前用户 */
    @GET("api/auth/me")
    suspend fun me(): User

    @POST("api/auth/logout")
    suspend fun logout()

    /** 修改密码；需 Bearer。旧 token 失效，响应带新 token，须覆盖本地。 */
    @PUT("api/auth/change-password")
    suspend fun changePassword(@Body body: com.vxin.app.data.model.ChangePasswordRequest): com.vxin.app.data.model.ChangePasswordResponse

    /** 注销账户（需当前密码确认；需 Bearer）。成功后本地须清登录态。 */
    @POST("api/auth/delete-account")
    suspend fun deleteAccount(@Body body: com.vxin.app.data.model.DeleteAccountRequest): com.vxin.app.data.model.SuccessResponse

    /** 忘记密码：手机号 + 邀请码验证后重置 */
    @POST("api/auth/reset-password")
    suspend fun resetPassword(@Body body: com.vxin.app.data.model.ResetPasswordRequest): com.vxin.app.data.model.SuccessResponse
}
