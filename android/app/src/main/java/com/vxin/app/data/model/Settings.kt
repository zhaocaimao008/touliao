package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 用户设置（GET /api/users/me/settings 的子集，按需取用） */
@Serializable
data class UserSettings(
    val chatBackground: String = "",
    val momentsVisibleDays: Int = 0,        // 朋友圈对他人可见天数：0=全部 / 1 / 3 / 30
)

/** 更新设置（仅传需要改的字段；这里只覆盖本期 P2 用到的项） */
@Serializable
data class UpdateSettingsBody(
    val momentsVisibleDays: Int? = null,
    val chatBackground: String? = null,
)
