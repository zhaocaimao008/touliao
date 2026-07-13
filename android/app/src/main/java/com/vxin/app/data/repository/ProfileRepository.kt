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

    /** 改密：返回后端新签发的 token（旧 token 已失效，须覆盖本地）。 */
    suspend fun changePassword(oldPassword: String, newPassword: String): String? =
        authApi.changePassword(ChangePasswordRequest(oldPassword, newPassword)).token

    /** 注销账户（需当前密码确认）。 */
    suspend fun deleteAccount(password: String) =
        authApi.deleteAccount(com.vxin.app.data.model.DeleteAccountRequest(password))

    /** 我的二维码 PNG 字节（需 Bearer） */
    suspend fun qrcodeBytes(): ByteArray = userApi.qrcode().bytes()

    /** 我的专属邀请码 + 邀请战绩 */
    suspend fun myInvite(): com.vxin.app.data.model.InviteInfo = userApi.myInvite()

    /** 通话记录 */
    suspend fun callLogs(limit: Int = 50): List<com.vxin.app.data.model.CallLog> = userApi.callLogs(limit)

    // ── 个人设置 ──
    suspend fun settings() = userApi.settings()

    /** 朋友圈"最近 N 天可见"：0=全部 / 1 / 3 / 30 */
    suspend fun setMomentsVisibleDays(days: Int) =
        userApi.updateSettings(com.vxin.app.data.model.UpdateSettingsBody(momentsVisibleDays = days))

    /** 通用设置更新：仅传需要改的字段，返回更新后的完整设置 */
    suspend fun updateSettings(body: com.vxin.app.data.model.UpdateSettingsBody) =
        userApi.updateSettings(body)
}
