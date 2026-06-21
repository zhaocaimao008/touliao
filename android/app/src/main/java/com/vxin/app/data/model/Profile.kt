package com.vxin.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class UpdateProfileRequest(val username: String? = null, val bio: String? = null)

@Serializable
data class ChangePasswordRequest(val oldPassword: String, val newPassword: String)

@Serializable
data class AvatarResponse(val avatar: String)
