package com.touliao.app.feature.chat

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.touliao.app.data.api.MessageApi
import com.touliao.app.data.model.LocalMsgStatus
import com.touliao.app.data.model.Message
import com.touliao.app.data.repository.ApiHistoryPageSource
import com.touliao.app.data.repository.HistoryPageSource
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Retrofit
import java.util.concurrent.CopyOnWriteArrayList

class HistoryPaginationRequestTest {
    @Test
    fun productionActionUsesConfirmedCompositeBoundaryForPrivateAndGroupSameSecondPages() = runBlocking {
        for (conversationId in listOf("private-conversation", "group-conversation")) {
            val fixture = retrofitFixture { request ->
                when {
                    request.url.queryParameter("before") == null -> messagesJson(11..60, conversationId, 200)
                    request.url.queryParameter("before") == "200" &&
                        request.url.queryParameter("beforeId") == "m-011" -> messagesJson(1..10, conversationId, 200)
                    else -> "[]"
                }
            }
            try {
                val source = ApiHistoryPageSource(fixture.api)
                val firstPage = source.loadHistory(conversationId)
                var state = ChatUiState(
                    messages = listOf(message("pending", conversationId, 199, LocalMsgStatus.SENDING)) + firstPage,
                )

                HistoryPaginationAction(source).execute(
                    conversationId = conversationId,
                    state = { state },
                    isCurrentAttempt = { true },
                    updateState = { transform -> state = transform(state) },
                )

                assertEquals(
                    (1..10).map { "m-%03d".format(it) } +
                        "pending" +
                        (11..60).map { "m-%03d".format(it) },
                    state.messages.map { it.id },
                )
                val confirmedIds = state.messages.filter { it.localStatus == null }.map { it.id }
                assertEquals((1..60).map { "m-%03d".format(it) }, confirmedIds)
                assertEquals(60, confirmedIds.toSet().size)
                assertEquals(false, state.loadingEarlier)
                assertEquals(true, state.reachedStart)
                val nextRequest = fixture.requests.last()
                assertEquals("200", nextRequest.url.queryParameter("before"))
                assertEquals("m-011", nextRequest.url.queryParameter("beforeId"))
            } finally {
                fixture.close()
            }
        }
    }

    @Test
    fun productionSourceEncodesExplicitCompositeCursorAndKeepsNoIdCompatibility() = runBlocking {
        val fixture = retrofitFixture { "[]" }
        try {
            val source = ApiHistoryPageSource(fixture.api)
            source.loadHistory("conversation", before = 200L)
            assertEquals(null, fixture.requests.last().url.queryParameter("beforeId"))

            source.loadHistory("conversation", before = 200L, beforeId = "m-011")
            assertEquals("200", fixture.requests.last().url.queryParameter("before"))
            assertEquals("m-011", fixture.requests.last().url.queryParameter("beforeId"))
        } finally {
            fixture.close()
        }
    }

    @Test
    fun crossSecondPageDeduplicatesAndEmptyTailMarksReachedStart() = runBlocking {
        val source = QueueSource(
            listOf(
                listOf(message("older", "conversation", 99), message("current", "conversation", 100)),
                emptyList(),
            )
        )
        var state = ChatUiState(messages = listOf(message("current", "conversation", 100)))
        val action = HistoryPaginationAction(source)

        action.execute("conversation", { state }, { true }) { state = it(state) }

        assertEquals(listOf("older", "current"), state.messages.map { it.id })
        assertEquals(true, state.reachedStart)
        state = state.copy(reachedStart = false)
        action.execute("conversation", { state }, { true }) { state = it(state) }
        assertEquals(listOf("older", "current"), state.messages.map { it.id })
        assertEquals(true, state.reachedStart)
        assertEquals(false, state.loadingEarlier)
    }

    @Test
    fun oldAccountOrABACompletionCannotMutateOrClearReplacementState() = runBlocking {
        for (aba in listOf(false, true)) {
            for (fails in listOf(false, true)) {
                val started = CompletableDeferred<Unit>()
                val release = CompletableDeferred<Unit>()
                val source = object : HistoryPageSource {
                    override suspend fun loadHistory(
                        conversationId: String,
                        before: Long?,
                        beforeId: String?,
                        after: Long?,
                    ): List<Message> {
                        started.complete(Unit)
                        release.await()
                        if (fails) throw IllegalStateException("synthetic failure")
                        return listOf(message("old-A", conversationId, 99))
                    }
                }
                var attempt = "A-1"
                var state = ChatUiState(messages = listOf(message("current-A", "conversation", 100)))
                val job = launch {
                    HistoryPaginationAction(source).execute(
                        "conversation",
                        { state },
                        { attempt == "A-1" },
                    ) { state = it(state) }
                }
                started.await()
                attempt = if (aba) "A-2" else "B-1"
                state = ChatUiState(
                    messages = listOf(message("replacement", "conversation", 300)),
                    loadingEarlier = true,
                )
                release.complete(Unit)
                job.join()

                assertEquals(listOf("replacement"), state.messages.map { it.id })
                assertEquals(true, state.loadingEarlier)
            }
        }
    }

    @Test
    fun failureAndCancellationOnlyClearTheCurrentAttemptLoadingFlag() = runBlocking {
        for (cancellation in listOf(false, true)) {
            val source = object : HistoryPageSource {
                override suspend fun loadHistory(
                    conversationId: String,
                    before: Long?,
                    beforeId: String?,
                    after: Long?,
                ): List<Message> {
                    if (cancellation) throw CancellationException("synthetic cancellation")
                    throw IllegalStateException("synthetic failure")
                }
            }
            var state = ChatUiState(messages = listOf(message("current", "conversation", 100)))
            var cancelled = false
            try {
                HistoryPaginationAction(source).execute(
                    "conversation",
                    { state },
                    { true },
                ) { state = it(state) }
            } catch (_: CancellationException) {
                cancelled = true
            }

            assertEquals(cancellation, cancelled)
            assertEquals(false, state.loadingEarlier)
            assertEquals(listOf("current"), state.messages.map { it.id })
        }
    }

    @Test
    fun loadingOrNoConfirmedBoundaryDoesNotIssueAnotherRequest() = runBlocking {
        var requests = 0
        val source = object : HistoryPageSource {
            override suspend fun loadHistory(
                conversationId: String,
                before: Long?,
                beforeId: String?,
                after: Long?,
            ): List<Message> {
                requests++
                return emptyList()
            }
        }
        val action = HistoryPaginationAction(source)
        var state = ChatUiState(
            messages = listOf(message("current", "conversation", 100)),
            loadingEarlier = true,
        )
        action.execute("conversation", { state }, { true }) { state = it(state) }
        state = ChatUiState(
            messages = listOf(message("pending", "conversation", 100, LocalMsgStatus.FAILED)),
        )
        action.execute("conversation", { state }, { true }) { state = it(state) }

        assertEquals(0, requests)
    }

    private data class RetrofitFixture(
        val api: MessageApi,
        val client: OkHttpClient,
        val requests: List<Request>,
    ) {
        fun close() {
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
        }
    }

    private fun retrofitFixture(body: (Request) -> String): RetrofitFixture {
        val requests = CopyOnWriteArrayList<Request>()
        val mediaType = "application/json".toMediaType()
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request()
                requests += request
                Response.Builder()
                    .request(request)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("Synthetic response")
                    .body(body(request).toResponseBody(mediaType))
                    .build()
            }
            .build()
        val api = Retrofit.Builder()
            .baseUrl("https://offline-fixture.invalid/")
            .client(client)
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory(mediaType))
            .build()
            .create(MessageApi::class.java)
        return RetrofitFixture(api, client, requests)
    }

    private fun messagesJson(ids: IntRange, conversationId: String, createdAt: Long): String =
        ids.joinToString(prefix = "[", postfix = "]") {
            """{"id":"m-%03d","conversation_id":"$conversationId","sender_id":"sender","created_at":$createdAt}""".format(it)
        }

    private fun message(
        id: String,
        conversationId: String,
        createdAt: Long,
        localStatus: String? = null,
    ) = Message(
        id = id,
        conversation_id = conversationId,
        sender_id = "sender",
        created_at = createdAt,
        localStatus = localStatus,
    )

    private class QueueSource(
        responses: List<List<Message>>,
    ) : HistoryPageSource {
        private val remaining = ArrayDeque(responses)
        override suspend fun loadHistory(
            conversationId: String,
            before: Long?,
            beforeId: String?,
            after: Long?,
        ): List<Message> = remaining.removeFirst()
    }
}
