package com.touliao.app.data.repository

import com.touliao.app.data.api.WalletApi
import com.touliao.app.core.network.RequestKeys
import com.touliao.app.core.storage.AccountStore
import com.touliao.app.core.storage.TokenStore
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import com.touliao.app.data.model.TransferRequest
import com.touliao.app.data.model.TransferResponse
import com.touliao.app.data.model.WalletTransaction
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WalletRepository @Inject constructor(
    private val walletApi: WalletApi,
    private val accountStore: AccountStore,
    private val tokenStore: TokenStore,
    private val json: Json,
    private val requestKeys: RequestKeys,
) {
    suspend fun balance(): Int = walletApi.balance().balance
    suspend fun transactions(limit: Int = 50, offset: Int = 0): List<WalletTransaction> =
        walletApi.transactions(limit, offset)

    /** 充值已下线（无支付网关），不再提供 recharge 调用。 */

    /** 好友转账 amount 金币（1-20000）到 toUserId，note 为备注（可选）。 */
    suspend fun transfer(toUserId: String, amount: Int, note: String = "", owner: TokenStore.Snapshot = tokenStore.snapshot()): TransferResponse {
        if (!tokenStore.isCurrent(owner)) throw java.io.IOException("Account changed before transfer")
        val body = TransferRequest(to_user_id = toUserId, amount = amount, note = note)
        val payload = json.encodeToString(body)
        val scope = "${owner.origin}:${accountStore.activeId()}:${owner.identityEpoch}"
        val key = requestKeys.key(scope, "transfer", payload)
        val result = walletApi.transfer(body, key, owner)
        requestKeys.complete(scope, "transfer", payload, key)
        return result
    }
}
