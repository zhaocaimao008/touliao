package com.touliao.app.data.api

import com.touliao.app.data.model.Collection
import com.touliao.app.data.model.CollectionPage
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface FavoritesApi {

    /** 我的收藏列表分页（服务端 limit 上限 100；Q13 全修：调用方必须续页，不能只拿一页当全量） */
    @GET("api/users/me/collections")
    suspend fun list(
        @Query("offset") offset: Int = 0,
        @Query("limit") limit: Int = 100,
    ): List<Collection>

    /** 搜索收藏（关键词 + 可选类型过滤） */
    @GET("api/users/me/collections/search")
    suspend fun search(
        @Query("q") q: String,
        @Query("type") type: String? = null,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): CollectionPage

    /** 取消收藏 */
    @DELETE("api/users/me/collections/{id}")
    suspend fun remove(@Path("id") id: String)
}
