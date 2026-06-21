package com.vxin.app.data.model

import kotlinx.serialization.Serializable

/** red_packet 类型消息的 content（JSON 字符串）解析结果 */
@Serializable
data class RedPacketContent(
    val packetId: String = "",
    val greeting: String = "",
    val totalCount: Int = 0,
    val totalAmount: Int = 0,
)

@Serializable
data class SendRedPacketBody(
    val conversationId: String,
    val totalAmount: Int,
    val totalCount: Int,
    val greeting: String = "",
)

@Serializable
data class SendRedPacketResponse(
    val packetId: String = "",
    val message: Message? = null,
)

@Serializable
data class RedPacketClaim(
    val packet_id: String = "",
    val user_id: String = "",
    val amount: Int = 0,
    val claimed_at: Long = 0,
    val username: String = "",
)

/** GET /api/redpackets/{id} 详情 */
@Serializable
data class RedPacketDetail(
    val id: String = "",
    val sender_id: String = "",
    val senderName: String = "",
    val total_amount: Int = 0,
    val total_count: Int = 0,
    val claimed_count: Int = 0,
    val greeting: String = "",
    val created_at: Long = 0,
    val claims: List<RedPacketClaim> = emptyList(),
    val myClaim: RedPacketClaim? = null,
)

@Serializable
data class ClaimRedPacketResponse(
    val success: Boolean = false,
    val amount: Int = 0,
)
