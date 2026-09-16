package com.touliao.app.data.repository

import com.touliao.app.data.api.MessageApi
import com.touliao.app.data.model.Message

/** Narrow history-only boundary used by chat pagination without constructing realtime dependencies. */
interface HistoryPageSource {
    suspend fun loadHistory(
        conversationId: String,
        before: Long? = null,
        beforeId: String? = null,
        after: Long? = null,
    ): List<Message>
}

class ApiHistoryPageSource(
    private val api: MessageApi,
) : HistoryPageSource {
    override suspend fun loadHistory(
        conversationId: String,
        before: Long?,
        beforeId: String?,
        after: Long?,
    ): List<Message> = api.history(
        conversationId,
        before = before,
        beforeId = beforeId,
        after = after,
    )
}
