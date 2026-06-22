package com.vxin.app.data.api

import com.vxin.app.data.model.AppConfig
import retrofit2.http.GET

interface ConfigApi {
    /** 功能开关（朋友圈/收藏），后台可隐藏。公开端点，无需鉴权。 */
    @GET("api/config")
    suspend fun getConfig(): AppConfig
}
