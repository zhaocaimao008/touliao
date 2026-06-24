package com.vxin.app.data.api

import com.vxin.app.data.model.TurnCredentials
import retrofit2.http.GET

interface TurnApi {
    /** 通话前拉取 ICE 配置（含时效 TURN 凭证）。需鉴权。 */
    @GET("api/turn/credentials")
    suspend fun getCredentials(): TurnCredentials
}
