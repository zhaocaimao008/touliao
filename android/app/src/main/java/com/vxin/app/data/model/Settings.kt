package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 用户设置（GET /api/users/me/settings，对齐后端 serializeSettings 全字段） */
@Serializable
data class UserSettings(
    val chatBackground: String = "",
    val momentsVisibleDays: Int = 0,        // 朋友圈对他人可见天数：0=全部 / 1 / 3 / 30
    // 隐私与安全
    val addByVxinId: Boolean = true,        // 允许通过 v信号添加
    val addByPhone: Boolean = true,         // 允许通过手机号添加
    val requireVerify: Boolean = true,      // 加我为好友需验证
    val noDirectGroupInvite: Boolean = false, // 不允许好友直接邀请我进群
    // 通知
    val messageNotify: Boolean = true,      // 新消息通知（锁屏）
    val detailPreview: Boolean = true,      // 通知详情预览
    val sound: Boolean = true,              // 通知声音
    val vibrate: Boolean = false,           // 通知震动
)

/** 更新设置（仅传需要改的字段，后端按 undefined 忽略） */
@Serializable
data class UpdateSettingsBody(
    val momentsVisibleDays: Int? = null,
    val chatBackground: String? = null,
    val addByVxinId: Boolean? = null,
    val addByPhone: Boolean? = null,
    val requireVerify: Boolean? = null,
    val noDirectGroupInvite: Boolean? = null,
    val messageNotify: Boolean? = null,
    val detailPreview: Boolean? = null,
    val sound: Boolean? = null,
    val vibrate: Boolean? = null,
)
