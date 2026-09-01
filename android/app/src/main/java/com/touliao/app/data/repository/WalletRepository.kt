package com.touliao.app.data.repository

import com.touliao.app.data.api.WalletApi
import com.touliao.app.data.model.TransferRequest
import com.touliao.app.data.model.TransferResponse
import com.touliao.app.data.model.WalletTransaction
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WalletRepository @Inject constructor(
    private val walletApi: WalletApi,
) {
    suspend fun balance(): Int = walletApi.balance().balance
    suspend fun transactions(limit: Int = 50, offset: Int = 0): List<WalletTransaction> =
        walletApi.transactions(limit, offset)

    /** 充值已下线（无支付网关），不再提供 recharge 调用。 */

    /** 好友转账 amount 金币（1-20000）到 toUserId，note 为备注（可选）。 */
    suspend fun transfer(toUserId: String, amount: Int, note: String = ""): TransferResponse =
        walletApi.transfer(TransferRequest(to_user_id = toUserId, amount = amount, note = note))
}
