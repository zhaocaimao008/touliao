package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 用户模型 —— 对齐后端 getMe 返回字段 */
@Serializable
data class User(
    val id: String,
    val username: String,
    val phone: String = "",
    val avatar: String = "",
    val bio: String = "",
    val wechat_id: String = "",
    val cover_photo: String = "",
)

@Serializable
data class LoginRequest(
    val phone: String,
    val password: String,
)

@Serializable
data class RegisterRequest(
    val phone: String,
    val password: String,
    val username: String,
    val inviteCode: String,
)

/** POST /api/auth/login | /register 的响应 */
@Serializable
data class AuthResponse(
    val token: String,
    val user: User,
)

/** POST /api/auth/reset-password — 忘记密码（手机号 + 邀请码验证） */
@Serializable
data class ResetPasswordRequest(
    val phone: String,
    val inviteCode: String,
    val newPassword: String,
)

@Serializable
data class SuccessResponse(
    val success: Boolean = true,
)

/** 后端统一错误体 { "error": "..." } */
@Serializable
data class ApiErrorBody(
    val error: String? = null,
)
