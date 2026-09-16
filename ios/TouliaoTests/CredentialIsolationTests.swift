import XCTest
@testable import Touliao

private final class Late401Protocol: URLProtocol {
    static var beforeResponse: (() -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.beforeResponse?()
        let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class CredentialIsolationTests: XCTestCase {
    func testLatePasswordSuccessCannotReplaceNewAccountOrABA() {
        for aba in [false, true] {
            var stored: String? = "fixture-A"
            let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 })
            let expected = credentials.snapshot()
            credentials.token = "fixture-B"
            if aba { credentials.token = "fixture-A" }
            var slot = "untouched"
            XCTAssertFalse(credentials.installReplacement(expected, token: "late-new-A") { slot = "overwritten" })
            XCTAssertEqual(slot, "untouched")
            XCTAssertEqual(credentials.token, aba ? "fixture-A" : "fixture-B")
            XCTAssertTrue(credentials.installReplacement(credentials.snapshot(), token: "current-new") { slot = "current-new" })
            XCTAssertEqual(slot, "current-new")
            XCTAssertEqual(credentials.token, "current-new")
        }
    }
    func testCurrentAndLate401JSONAndBytes() async {
      for rotate in [false, true] {
        for bytes in [false, true] {
            var stored: String? = "fixture-A"
            let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 })
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [Late401Protocol.self]
            let session = URLSession(configuration: config)
            defer { session.invalidateAndCancel(); Late401Protocol.beforeResponse = nil }
            let client = APIClient(session: session, credentials: credentials, baseURL: { "https://fixture.invalid" })
            Late401Protocol.beforeResponse = { if rotate { credentials.token = "fixture-B" } }
            do {
                if bytes { _ = try await client.fetchData("api/fixture") }
                else { let _: EmptyResponse = try await client.send("api/fixture") }
                XCTFail("Expected unauthorized")
            } catch APIError.unauthorized {} catch { XCTFail("Expected unauthorized, got \(error)") }
            XCTAssertEqual(credentials.token, rotate ? "fixture-B" : nil)
        }
      }
    }

    func testQueuedUnauthorizedAndABAStayInvalidButNewSameOwnerActionWorks() {
        var stored: String? = "fixture-A"
        let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 })
        let old = credentials.snapshot()
        credentials.token = "fixture-B"
        credentials.token = "fixture-A"
        XCTAssertNil(credentials.invalidate(old))
        XCTAssertFalse(credentials.isCurrent(old))
        XCTAssertTrue(credentials.isCurrent(credentials.snapshot()))
        let marker = credentials.invalidate(credentials.snapshot())!
        credentials.token = "fixture-B"
        var loggedOut = false
        credentials.withCurrent(marker) { loggedOut = true }
        XCTAssertFalse(loggedOut)
        XCTAssertEqual(credentials.token, "fixture-B")
    }
}
