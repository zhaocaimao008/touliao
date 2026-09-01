package com.touliao.app.data.model

import kotlinx.serialization.Serializable

/** GET /api/config 响应：后台功能开关（朋友圈/收藏可隐藏）。 */
@Serializable
data class AppConfig(val features: Features = Features())

@Serializable
data class Features(
    val moments: Boolean = true,        // 朋友圈
    val collect: Boolean = true,        // 收藏
    val inviteRequired: Boolean = true, // 注册是否需要邀请码
    val groupVoiceCall: Boolean = true, // 群语音通话（后台可关，关后隐藏群语音按钮）
    val groupVideoCall: Boolean = true, // 群视频通话（后台可关，关后隐藏群视频按钮）
    val changePassword: Boolean = true, // 自助修改密码（后台可关，关后隐藏入口 + 后端拦截）
    val loginCaptcha: Boolean = false,  // 登录图形验证码（默认关闭——只有确认后端+四端都已支持才由后台打开）
    val aiAssistants: List<AiAssistant> = emptyList(), // AI 助手入口列表（通讯录固定分组）
)

/** AI 助手（天问/Hermes 等机器人账号，数据来自后端 /api/config） */
@Serializable
data class AiAssistant(
    val id: String = "",
    val name: String = "",
    val username: String = "",
    val wechat_id: String = "",
    val avatar: String = "",
    val provider: String = "",
    val description: String = "",
)
