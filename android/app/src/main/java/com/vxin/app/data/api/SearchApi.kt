package com.vxin.app.data.api

import com.vxin.app.data.model.SearchResponse
import retrofit2.http.GET
import retrofit2.http.Query

interface SearchApi {

    /** 全局消息搜索 */
    @GET("api/messages/search")
    suspend fun search(
        @Query("q") q: String,
        @Query("limit") limit: Int = 30,
    ): SearchResponse
}
