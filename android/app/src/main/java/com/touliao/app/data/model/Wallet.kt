package com.touliao.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class WalletBalance(val balance: Int = 0)

/** POST /api/wallet/recharge 请求体（amount 单位：金币，1-100000）。 */
@Serializable
data class RechargeRequest(val amount: Int)

/** 充值响应 —— { success, balance, recharged } */
@Serializable
data class RechargeResponse(
    val success: Boolean = false,
    val balance: Int = 0,
    val recharged: Int = 0,
)

/** 钱包流水（对齐后端 wallet_transactions 返回字段）。amount 正=入账/负=出账。 */
@Serializable
data class WalletTransaction(
    val id: String = "",
    val amount: Int = 0,
    @SerialName("balance_after") val balanceAfter: Int = 0,
    val type: String = "",
    @SerialName("ref_id") val refId: String? = null,
    val memo: String = "",
    @SerialName("created_at") val createdAt: Long = 0,
)

// ── 好友转账 ────────────────────────────────────────────────

/** POST /api/wallet/transfer 请求体（to_user_id, amount, note 可选）。 */
@Serializable
data class TransferRequest(
    val to_user_id: String,
    val amount: Int,
    val note: String = "",
)

/** 转账响应：{ success, balance, message? }。message 为新产生的 transfer 类型消息（可选）。 */
@Serializable
data class TransferResponse(
    val success: Boolean = false,
    val balance: Int = 0,
    val message: Message? = null,
)

/** transfer 类型消息的 content（JSON 字符串）解析结果。
 *  与 web 端对齐：amount / note / toUserId / toUsername。 */
@Serializable
data class TransferContent(
    val amount: Int = 0,
    val note: String = "",
    val toUserId: String = "",
    val toUsername: String = "",
)
