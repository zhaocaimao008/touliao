package com.touliao.app.data.repository

import com.touliao.app.data.api.FavoritesApi
import com.touliao.app.data.model.Collection
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FavoritesRepository @Inject constructor(
    private val favoritesApi: FavoritesApi,
) {
    // Q13 全修：收藏最多 1000 条，服务端单页上限 100——只请求一次默认页时，超过 100 条
    // 的旧收藏在列表/本地类型过滤里都摸不到。续页直到拿到一页不满(page.size < PAGE_SIZE)。
    suspend fun list(): List<Collection> {
        val all = mutableListOf<Collection>()
        var offset = 0
        while (true) {
            val page = favoritesApi.list(offset = offset, limit = PAGE_SIZE)
            all += page
            if (page.size < PAGE_SIZE) break
            offset += PAGE_SIZE
        }
        return all
    }

    suspend fun search(q: String, type: String? = null): List<Collection> =
        favoritesApi.search(q, type?.ifBlank { null }).items

    suspend fun remove(id: String) = favoritesApi.remove(id)

    private companion object {
        const val PAGE_SIZE = 100
    }
}
