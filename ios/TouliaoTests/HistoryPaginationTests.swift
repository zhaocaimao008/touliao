import XCTest
@testable import Touliao

private final class HistoryURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> String)?
    static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let body = Self.handler?(request) ?? "[]"
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class ClosureHistoryPageSource: HistoryPageSource {
    var calls = 0
    let handler: () throws -> [Message]
    init(handler: @escaping () throws -> [Message]) { self.handler = handler }
    func loadHistory(_ conversationId: String, before: Double?, beforeId: String?) async throws -> [Message] {
        calls += 1
        return try handler()
    }
}

@MainActor
final class HistoryPaginationTests: XCTestCase {
    func testProductionActionAndRepositoryUseCompositeCursorForPrivateAndGroupSameSecondPages() async throws {
        for conversationId in ["private-conversation", "group-conversation"] {
            let repository = makeRepository { request in
                let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
                let before = components.queryItems?.first(where: { $0.name == "before" })?.value
                let beforeId = components.queryItems?.first(where: { $0.name == "beforeId" })?.value
                if before == nil { return self.messagesJSON(11...60, conversationId, 200) }
                if before == "200", beforeId == "m-011" {
                    return self.messagesJSON(1...10, conversationId, 200)
                }
                return "[]"
            }
            let firstPage = try await repository.loadHistory(conversationId)
            var state = HistoryPaginationState(
                messages: [message("pending", conversationId, 199, LocalMsgStatus.sending)] + firstPage
            )

            await HistoryPaginationAction(source: repository).execute(
                conversationId: conversationId,
                state: { state },
                isCurrentAttempt: { true },
                apply: { state = $0 }
            )

            XCTAssertEqual(
                state.messages.map(\.id),
                (1...10).map { String(format: "m-%03d", $0) } +
                    ["pending"] +
                    (11...60).map { String(format: "m-%03d", $0) }
            )
            let confirmed = state.messages.filter { $0.localStatus == nil }.map(\.id)
            XCTAssertEqual(confirmed, (1...60).map { String(format: "m-%03d", $0) })
            XCTAssertEqual(Set(confirmed).count, 60)
            XCTAssertEqual(queryValue("before"), "200")
            XCTAssertEqual(queryValue("beforeId"), "m-011")
        }
    }

    func testRepositoryKeepsTimestampOnlyCompatibilityAndEncodesExplicitBoundaryId() async throws {
        let repository = makeRepository { _ in "[]" }
        _ = try await repository.loadHistory("conversation", before: 200)
        XCTAssertNil(queryValue("beforeId"))
        _ = try await repository.loadHistory("conversation", before: 200, beforeId: "message/id")
        XCTAssertEqual(queryValue("before"), "200")
        XCTAssertEqual(queryValue("beforeId"), "message/id")
    }

    func testCrossSecondDuplicateAndEmptyTailAreStable() async {
        var responses = [
            [message("older", "conversation", 99), message("current", "conversation", 100)],
            [],
        ]
        let source = ClosureHistoryPageSource { responses.removeFirst() }
        let action = HistoryPaginationAction(source: source)
        var state = HistoryPaginationState(messages: [message("current", "conversation", 100)])

        await action.execute(conversationId: "conversation", state: { state }, isCurrentAttempt: { true }) { state = $0 }
        XCTAssertEqual(state.messages.map(\.id), ["older", "current"])
        XCTAssertTrue(state.reachedStart)
        state.reachedStart = false
        await action.execute(conversationId: "conversation", state: { state }, isCurrentAttempt: { true }) { state = $0 }
        XCTAssertEqual(state.messages.map(\.id), ["older", "current"])
        XCTAssertTrue(state.reachedStart)
        XCTAssertFalse(state.loadingEarlier)
    }

    func testOldIdentityAndABASuccessOrFailureCannotMutateOrClearReplacementState() async {
        for aba in [false, true] {
            for fails in [false, true] {
                var attempt = "A-1"
                var state = HistoryPaginationState(messages: [message("current-A", "conversation", 100)])
                let source = ClosureHistoryPageSource {
                    attempt = aba ? "A-2" : "B-1"
                    state = HistoryPaginationState(
                        messages: [self.message("replacement", "conversation", 300)],
                        loadingEarlier: true
                    )
                    if fails { throw APIError.network }
                    return [self.message("old-A", "conversation", 99)]
                }

                await HistoryPaginationAction(source: source).execute(
                    conversationId: "conversation",
                    state: { state },
                    isCurrentAttempt: { attempt == "A-1" },
                    apply: { state = $0 }
                )

                XCTAssertEqual(state.messages.map(\.id), ["replacement"])
                XCTAssertTrue(state.loadingEarlier)
            }
        }
    }

    func testLoadingOrPendingOnlyStateDoesNotRequestHistory() async {
        let source = ClosureHistoryPageSource { [] }
        let action = HistoryPaginationAction(source: source)
        var state = HistoryPaginationState(
            messages: [message("current", "conversation", 100)],
            loadingEarlier: true
        )
        await action.execute(conversationId: "conversation", state: { state }, isCurrentAttempt: { true }) { state = $0 }
        state = HistoryPaginationState(
            messages: [message("pending", "conversation", 100, LocalMsgStatus.failed)]
        )
        await action.execute(conversationId: "conversation", state: { state }, isCurrentAttempt: { true }) { state = $0 }
        XCTAssertEqual(source.calls, 0)
    }

    private func makeRepository(handler: @escaping (URLRequest) -> String) -> ChatRepository {
        HistoryURLProtocol.requests = []
        HistoryURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HistoryURLProtocol.self]
        let session = URLSession(configuration: configuration)
        var token: String? = "synthetic-token"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let api = APIClient(session: session, credentials: credentials, baseURL: { "https://fixture.invalid" })
        return ChatRepository(api: api)
    }

    private func queryValue(_ name: String) -> String? {
        URLComponents(url: HistoryURLProtocol.requests.last!.url!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == name })?.value
    }

    private func messagesJSON(_ ids: ClosedRange<Int>, _ conversationId: String, _ createdAt: Int) -> String {
        "[" + ids.map {
            """{"id":"\(String(format: "m-%03d", $0))","conversation_id":"\(conversationId)","sender_id":"sender","created_at":\(createdAt)}"""
        }.joined(separator: ",") + "]"
    }

    private func message(_ id: String, _ conversationId: String, _ createdAt: Double, _ status: String? = nil) -> Message {
        var value = Message(cachedId: id, conversationId: conversationId, senderId: "sender")
        value.createdAt = createdAt
        value.localStatus = status
        return value
    }
}
