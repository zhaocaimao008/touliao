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
}
