package com.vxin.app.data.repository

import com.vxin.app.data.api.AuthApi
import com.vxin.app.data.api.UserApi
import com.vxin.app.data.model.ChangePasswordRequest
import com.vxin.app.data.model.UpdateProfileRequest
import com.vxin.app.data.model.User
import okhttp3.MultipartBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProfileRepository @Inject constructor(
    private val userApi: UserApi,
    private val authApi: AuthApi,
) {
    suspend fun updateProfile(username: String?, bio: String?): User =
        userApi.updateProfile(UpdateProfileRequest(username, bio))

    suspend fun uploadAvatar(part: MultipartBody.Part): String =
        userApi.uploadAvatar(part).avatar

    suspend fun changePassword(oldPassword: String, newPassword: String) =
        authApi.changePassword(ChangePasswordRequest(oldPassword, newPassword))

    /** 我的二维码 PNG 字节（需 Bearer） */
    suspend fun qrcodeBytes(): ByteArray = userApi.qrcode().bytes()

    // ── 个人设置 ──
    suspend fun settings() = userApi.settings()

    /** 朋友圈"最近 N 天可见"：0=全部 / 1 / 3 / 30 */
    suspend fun setMomentsVisibleDays(days: Int) =
        userApi.updateSettings(com.vxin.app.data.model.UpdateSettingsBody(momentsVisibleDays = days))
}
