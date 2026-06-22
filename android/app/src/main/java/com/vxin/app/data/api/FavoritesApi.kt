package com.vxin.app.data.api

import com.vxin.app.data.model.Collection
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Path

interface FavoritesApi {

    /** 我的收藏列表 */
    @GET("api/users/me/collections")
    suspend fun list(): List<Collection>

    /** 取消收藏 */
    @DELETE("api/users/me/collections/{id}")
    suspend fun remove(@Path("id") id: String)
}
