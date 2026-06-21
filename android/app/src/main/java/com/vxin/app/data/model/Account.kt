package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 本地保存的已登录账号（含 token，用于多账号秒切换） */
@Serializable
data class Account(
    val id: String,
    val username: String = "",
    val avatar: String = "",
    val token: String,
)
