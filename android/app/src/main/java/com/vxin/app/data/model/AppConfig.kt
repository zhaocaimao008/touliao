package com.vxin.app.data.model

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
)
