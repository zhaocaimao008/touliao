package com.vxin.app.data.repository

import com.vxin.app.data.api.WalletApi
import com.vxin.app.data.model.RechargeResponse
import com.vxin.app.data.model.RechargeRequest
import com.vxin.app.data.model.TransferRequest
import com.vxin.app.data.model.TransferResponse
import com.vxin.app.data.model.WalletTransaction
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WalletRepository @Inject constructor(
    private val walletApi: WalletApi,
) {
    suspend fun balance(): Int = walletApi.balance().balance
    suspend fun transactions(limit: Int = 50, offset: Int = 0): List<WalletTransaction> =
        walletApi.transactions(limit, offset)

    /** 充值 amount 金币（1-100000），返回最新余额与入账数。 */
    suspend fun recharge(amount: Int): RechargeResponse =
        walletApi.recharge(RechargeRequest(amount))

    /** 好友转账 amount 金币（1-20000）到 toUserId，note 为备注（可选）。 */
    suspend fun transfer(toUserId: String, amount: Int, note: String = ""): TransferResponse =
        walletApi.transfer(TransferRequest(to_user_id = toUserId, amount = amount, note = note))
}
