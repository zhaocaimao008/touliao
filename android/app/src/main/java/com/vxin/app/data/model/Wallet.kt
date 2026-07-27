package com.vxin.app.data.model

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
