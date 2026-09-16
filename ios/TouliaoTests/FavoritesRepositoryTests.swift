import XCTest
@testable import Touliao

/// Q13 全修：收藏最多 1000 条，服务端单页上限 100——原来 list() 只请求一次默认页，
/// 超过 100 条的旧收藏永久不可达（Android/Web 同一个洞，各端独立修）。
private final class FavoritesURLProtocol: URLProtocol {
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

final class FavoritesRepositoryTests: XCTestCase {
    private func makeRepository(handler: @escaping (URLRequest) -> String) -> FavoritesRepository {
        FavoritesURLProtocol.requests = []
        FavoritesURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FavoritesURLProtocol.self]
        let session = URLSession(configuration: configuration)
        var token: String? = "synthetic-token"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let api = APIClient(session: session, credentials: credentials, baseURL: { "https://fixture.invalid" })
        return FavoritesRepository(api: api)
    }

    private func offsetOf(_ request: URLRequest) -> Int? {
        URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "offset" })?.value.flatMap(Int.init)
    }

    private func pageJSON(_ ids: Range<Int>) -> String {
        "[" + ids.map { "{\"id\":\"c-\($0)\"}" }.joined(separator: ",") + "]"
    }

    func testListContinuesPastFirst100ItemPageUntilAShortPageIsReturned() async throws {
        let repository = makeRepository { request in
            switch self.offsetOf(request) {
            case 0: return self.pageJSON(0..<100)
            case 100: return self.pageJSON(100..<150)
            default: return "[]"
            }
        }

        let result = try await repository.list()

        XCTAssertEqual(result.count, 150)
        XCTAssertEqual(result.first?.id, "c-0")
        XCTAssertEqual(result.last?.id, "c-149")
        XCTAssertEqual(FavoritesURLProtocol.requests.compactMap(offsetOf), [0, 100])
    }

    func testListStopsAfterASingleShortPageWithoutAnExtraRequest() async throws {
        let repository = makeRepository { _ in self.pageJSON(0..<40) }

        let result = try await repository.list()

        XCTAssertEqual(result.count, 40)
        XCTAssertEqual(FavoritesURLProtocol.requests.count, 1)
    }

    func testListConfirmsExhaustionWithOneExtraRequestWhenAPageLandsExactlyOnThePageSize() async throws {
        let repository = makeRepository { request in
            self.offsetOf(request) == 0 ? self.pageJSON(0..<100) : "[]"
        }

        let result = try await repository.list()

        XCTAssertEqual(result.count, 100)
        XCTAssertEqual(FavoritesURLProtocol.requests.compactMap(offsetOf), [0, 100])
    }
}
