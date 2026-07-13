package com.vxin.app.data.api

import com.vxin.app.data.model.WalletBalance
import com.vxin.app.data.model.WalletTransaction
import retrofit2.http.GET
import retrofit2.http.Query

/** 钱包（余额 / 流水）。充值端点后端暂关闭（503），此处不接入。 */
interface WalletApi {
    @GET("api/wallet")
    suspend fun balance(): WalletBalance

    @GET("api/wallet/transactions")
    suspend fun transactions(
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<WalletTransaction>
}
