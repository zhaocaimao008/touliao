package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** GET /api/turn/credentials 响应：可直接构建 PeerConnection.IceServer 的列表。 */
@Serializable
data class TurnCredentials(
    val iceServers: List<IceServerDto> = emptyList(),
    val ttl: Int = 3600,
)

@Serializable
data class IceServerDto(
    // 后端 urls 可能是单个字符串或字符串数组；统一在解析后展开使用
    val urls: List<String> = emptyList(),
    val username: String? = null,
    val credential: String? = null,
)
