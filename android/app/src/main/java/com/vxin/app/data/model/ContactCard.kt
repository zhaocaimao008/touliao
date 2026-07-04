package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** contact_card 类型消息的 content（JSON 字符串）解析结果；字段与 web/iOS 发送方一致。 */
@Serializable
data class ContactCardContent(
    val uid: String = "",
    val username: String = "",
    val avatar: String = "",
    val wechat_id: String = "",
)
