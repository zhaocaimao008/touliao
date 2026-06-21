package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** 二维码内容：服务端 GET /api/users/me/qrcode 编码的 JSON。 */
@Serializable
data class QrPayload(
    val type: String = "",
    val id: String = "",
    val vxinId: String = "",
)
