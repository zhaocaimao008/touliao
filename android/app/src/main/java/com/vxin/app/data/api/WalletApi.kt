package com.vxin.app.data.api

import com.vxin.app.data.model.RechargeRequest
import com.vxin.app.data.model.RechargeResponse
import com.vxin.app.data.model.WalletBalance
import com.vxin.app.data.model.WalletTransaction
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/** 钱包（余额 / 流水 / 充值）。 */
interface WalletApi {
    @GET("api/wallet")
    suspend fun balance(): WalletBalance

    @GET("api/wallet/transactions")
    suspend fun transactions(
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<WalletTransaction>

    /** 充值：amount 1-100000 金币，成功返回最新余额。 */
    @POST("api/wallet/recharge")
    suspend fun recharge(@Body body: RechargeRequest): RechargeResponse
}
