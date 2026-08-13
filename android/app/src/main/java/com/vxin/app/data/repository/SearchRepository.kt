package com.touliao.app.data.repository

import com.touliao.app.data.api.SearchApi
import com.touliao.app.data.model.SearchResult
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SearchRepository @Inject constructor(
    private val searchApi: SearchApi,
) {
    suspend fun search(q: String): List<SearchResult> = searchApi.search(q).results
}
