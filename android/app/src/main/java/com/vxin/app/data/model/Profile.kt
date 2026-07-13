package com.vxin.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class UpdateProfileRequest(val username: String? = null, val bio: String? = null)

@Serializable
data class ChangePasswordRequest(val oldPassword: String, val newPassword: String)

/** 改密响应：后端下发新 token（旧 token 已失效），Bearer 客户端须用它覆盖本地。 */
@Serializable
data class ChangePasswordResponse(val success: Boolean = true, val token: String? = null)

/** 注销账户请求：需当前密码确认。 */
@Serializable
data class DeleteAccountRequest(val password: String)

@Serializable
data class AvatarResponse(val avatar: String)
