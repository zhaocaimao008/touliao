package com.vxin.app.data.repository

import com.vxin.app.data.api.WalletApi
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
}
