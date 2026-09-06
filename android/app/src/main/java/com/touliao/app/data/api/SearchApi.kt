package com.touliao.app.data.api

import com.touliao.app.data.model.SearchResponse
import retrofit2.http.GET
import retrofit2.http.Query

interface SearchApi {

    /**
     * 全局消息搜索。type/from/to/senderId 均可选、不传保持原行为（后端走 FTS 缓存路径）；
     * 传入任一筛选则走 LIKE 条件路径（后端 searchGlobal）。from/to 为 epoch 秒。
     */
    @GET("api/messages/search")
    suspend fun search(
        @Query("q") q: String,
        @Query("limit") limit: Int = 30,
        @Query("type") type: String? = null,
        @Query("from") from: Long? = null,
        @Query("to") to: Long? = null,
        @Query("senderId") senderId: String? = null,
    ): SearchResponse
}
