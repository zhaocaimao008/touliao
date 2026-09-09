package com.touliao.app.data.repository

import com.touliao.app.data.api.FavoritesApi
import com.touliao.app.data.model.Collection
import com.touliao.app.data.model.CollectionPage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Q13 全修：收藏最多 1000 条，服务端单页上限 100——原来 list() 只请求一次默认页，
 * 超过 100 条的旧收藏永久不可达（Web/iOS 同一个洞，各端独立修）。
 */
private fun collection(id: String) = Collection(id = id, type = "text", content = id)

class FavoritesRepositoryTest {

    private class FakeFavoritesApi(private val total: Int) : FavoritesApi {
        var callCount = 0
        val requestedOffsets = mutableListOf<Int>()
        override suspend fun list(offset: Int, limit: Int): List<Collection> {
            callCount++
            requestedOffsets += offset
            val remaining = (total - offset).coerceAtLeast(0)
            val pageSize = remaining.coerceAtMost(limit)
            return (0 until pageSize).map { collection("c-${offset + it}") }
        }
        override suspend fun search(q: String, type: String?, limit: Int, offset: Int): CollectionPage =
            CollectionPage(items = emptyList(), total = 0)
        override suspend fun remove(id: String) {}
    }

    @Test
    fun `list continues past the first 100-item page until a short page is returned`() = runBlocking {
        val api = FakeFavoritesApi(total = 150)
        val repo = FavoritesRepository(api)

        val result = repo.list()

        assertEquals(150, result.size)
        assertEquals(listOf("c-0", "c-149"), listOf(result.first().id, result.last().id))
        assertEquals(listOf(0, 100), api.requestedOffsets)
    }

    @Test
    fun `list stops after a single short page without an extra request`() = runBlocking {
        val api = FakeFavoritesApi(total = 40)
        val repo = FavoritesRepository(api)

        val result = repo.list()

        assertEquals(40, result.size)
        assertEquals(1, api.callCount)
    }

    @Test
    fun `list confirms exhaustion with one extra request when a page lands exactly on the page size`() = runBlocking {
        val api = FakeFavoritesApi(total = 100)
        val repo = FavoritesRepository(api)

        val result = repo.list()

        assertEquals(100, result.size)
        assertEquals(listOf(0, 100), api.requestedOffsets) // 第二次请求确认真的没有更多了
    }

    @Test
    fun `list handles zero collections without error`() = runBlocking {
        val api = FakeFavoritesApi(total = 0)
        val repo = FavoritesRepository(api)

        val result = repo.list()

        assertEquals(emptyList<Collection>(), result)
        assertEquals(1, api.callCount)
    }
}
