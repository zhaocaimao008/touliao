package com.touliao.app.feature.chat

import com.touliao.app.data.repository.HistoryPageSource
import kotlinx.coroutines.CancellationException

internal class HistoryPaginationAction(
    private val source: HistoryPageSource,
    private val pageSize: Int = 50,
) {
    suspend fun execute(
        conversationId: String,
        state: () -> ChatUiState,
        isCurrentAttempt: () -> Boolean,
        updateState: (((ChatUiState) -> ChatUiState)) -> Unit,
    ) {
        if (!isCurrentAttempt()) return
        val snapshot = state()
        if (snapshot.loadingEarlier || snapshot.reachedStart) return
        val boundary = snapshot.messages.firstOrNull {
            it.localStatus == null && it.id.isNotBlank()
        } ?: return

        var started = false
        updateState { current ->
            if (!isCurrentAttempt() || current.loadingEarlier || current.reachedStart) current
            else current.copy(loadingEarlier = true).also { started = true }
        }
        if (!started) return

        try {
            val older = source.loadHistory(
                conversationId = conversationId,
                before = boundary.created_at,
                beforeId = boundary.id,
            )
            if (!isCurrentAttempt()) return
            updateState { current ->
                if (!isCurrentAttempt()) current
                else {
                    val existing = current.messages.mapTo(HashSet()) { it.id }
                    current.copy(
                        messages = older.filterNot { it.id in existing } + current.messages,
                        reachedStart = older.size < pageSize,
                    )
                }
            }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
        } finally {
            if (isCurrentAttempt()) {
                updateState { current ->
                    if (isCurrentAttempt()) current.copy(loadingEarlier = false) else current
                }
            }
        }
    }
}
