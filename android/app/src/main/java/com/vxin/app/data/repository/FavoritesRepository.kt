package com.vxin.app.data.repository

import com.vxin.app.data.api.FavoritesApi
import com.vxin.app.data.model.Collection
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FavoritesRepository @Inject constructor(
    private val favoritesApi: FavoritesApi,
) {
    suspend fun list(): List<Collection> = favoritesApi.list()

    suspend fun search(q: String, type: String? = null): List<Collection> =
        favoritesApi.search(q, type?.ifBlank { null }).items

    suspend fun remove(id: String) = favoritesApi.remove(id)
}
