package com.touliao.app.data.repository

import com.touliao.app.data.api.SearchApi
import com.touliao.app.data.model.SearchResult
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SearchRepository @Inject constructor(
    private val searchApi: SearchApi,
) {
    /** F4b 搜索筛选：type/from/to/senderId 可选（空=null 不随请求发送，保持原行为） */
    suspend fun search(
        q: String,
        type: String? = null,
        from: Long? = null,
        to: Long? = null,
        senderId: String? = null,
    ): List<SearchResult> = searchApi.search(q, type = type?.takeIf { it.isNotBlank() }, from = from, to = to, senderId = senderId?.takeIf { it.isNotBlank() }).results
}
