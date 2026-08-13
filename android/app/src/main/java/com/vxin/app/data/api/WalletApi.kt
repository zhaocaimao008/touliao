package com.touliao.app.data.api

import com.touliao.app.data.model.RechargeRequest
import com.touliao.app.data.model.RechargeResponse
import com.touliao.app.data.model.TransferRequest
import com.touliao.app.data.model.TransferResponse
import com.touliao.app.data.model.WalletBalance
import com.touliao.app.data.model.WalletTransaction
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/** 钱包（余额 / 流水 / 充值 / 好友转账）。 */
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

    /** 好友转账：amount 1-20000 金币，成功后返回最新余额及 transfer 类型消息。 */
    @POST("api/wallet/transfer")
    suspend fun transfer(@Body body: TransferRequest): TransferResponse
}
