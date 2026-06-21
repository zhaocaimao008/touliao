package com.vxin.app.data.repository

import com.vxin.app.data.api.SearchApi
import com.vxin.app.data.model.SearchResult
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SearchRepository @Inject constructor(
    private val searchApi: SearchApi,
) {
    suspend fun search(q: String): List<SearchResult> = searchApi.search(q).results
}
