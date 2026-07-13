package com.vxin.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class WalletBalance(val balance: Int = 0)

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
