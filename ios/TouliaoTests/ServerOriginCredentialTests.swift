import XCTest
@testable import Touliao

private final class HeaderRecordingProtocol: URLProtocol {
    static var authorization: [String?] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.authorization.append(request.value(forHTTPHeaderField: "Authorization"))
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// 审计 F02：切换服务器后，旧服务器签发的 Bearer 不得发往新服务器。
final class ServerOriginCredentialTests: XCTestCase {
    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "ServerOriginCredentialTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        HeaderRecordingProtocol.authorization = []
        super.tearDown()
    }

    func testOriginNormalizationIgnoresPathCaseAndDefaultPort() {
        XCTAssertEqual(ServerConfig.origin(of: "HTTPS://Tenant.Example:443/api/"), "https://tenant.example")
        XCTAssertEqual(ServerConfig.origin(of: "http://tenant.example:80"), "http://tenant.example")
        XCTAssertEqual(ServerConfig.origin(of: "https://tenant.example:8443/x"), "https://tenant.example:8443")
        XCTAssertNil(ServerConfig.origin(of: "tenant.example"))
        XCTAssertNil(ServerConfig.origin(of: "ftp://tenant.example"))
    }

    func testTokenIsOnlyReadableOnTheOriginThatIssuedIt() {
        var stored: String?
        var current = "https://a.invalid"
        let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 }, currentOrigin: { current })
        credentials.token = "synthetic-tenant-A-credential"
        XCTAssertEqual(credentials.token, "synthetic-tenant-A-credential")
        current = "https://b.invalid"
        XCTAssertNil(credentials.token)
        XCTAssertNil(credentials.snapshot().token)
        current = "https://a.invalid"
        XCTAssertEqual(credentials.token, "synthetic-tenant-A-credential")
    }

    func testLegacyTokenWithoutOwnerIsBoundToCurrentOriginOnce() {
        var stored: String? = "synthetic-legacy"
        var current = "https://a.invalid"
        let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 }, currentOrigin: { current })
        XCTAssertEqual(credentials.token, "synthetic-legacy")
        current = "https://b.invalid"
        XCTAssertNil(credentials.token)
    }

    func testSwitchingServerClearsCredentialAndInvalidatesOldSnapshot() {
        var stored: String?
        var config: ServerConfig!
        let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 }, currentOrigin: { config.origin })
        config = ServerConfig(defaults: defaults, credentials: { credentials })
        config.baseURL = "https://a.invalid"
        credentials.token = "synthetic-tenant-A-credential"
        let before = credentials.snapshot()

        let posted = expectation(forNotification: ServerConfig.originDidChangeNotification, object: config) { note in
            (note.userInfo?["marker"] as? KeychainStore.Snapshot).map(credentials.isCurrent) ?? false
        }
        config.baseURL = "https://b.invalid/"
        wait(for: [posted], timeout: 1)

        XCTAssertEqual(config.origin, "https://b.invalid")
        XCTAssertNil(stored)
        XCTAssertNil(credentials.token)
        XCTAssertFalse(credentials.isCurrent(before))
        XCTAssertGreaterThan(credentials.snapshot().identityEpoch, before.identityEpoch)
    }

    func testSameOriginPathChangeAndInvalidInputKeepCredential() {
        var stored: String?
        var config: ServerConfig!
        let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 }, currentOrigin: { config.origin })
        config = ServerConfig(defaults: defaults, credentials: { credentials })
        config.baseURL = "https://a.invalid"
        credentials.token = "synthetic-tenant-A-credential"
        let before = credentials.snapshot()
        config.baseURL = "https://A.invalid/"
        config.baseURL = "not a server"
        config.setRemote("javascript:alert(1)")
        XCTAssertEqual(config.baseURL, "https://A.invalid")
        XCTAssertEqual(credentials.token, "synthetic-tenant-A-credential")
        XCTAssertTrue(credentials.isCurrent(before))
    }

    func testRemoteConfigSwitchClearsCredentialOnlyWithoutManualOverride() {
        var stored: String?
        var config: ServerConfig!
        let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 }, currentOrigin: { config.origin })
        config = ServerConfig(defaults: defaults, credentials: { credentials })
        config.baseURL = "https://a.invalid"
        credentials.token = "synthetic-tenant-A-credential"
        config.setRemote("https://remote.invalid")
        XCTAssertEqual(credentials.token, "synthetic-tenant-A-credential")
        config.clearManualOverride()
        XCTAssertEqual(config.origin, "https://remote.invalid")
        XCTAssertNil(credentials.token)
    }

    func testAPIClientNeverSendsBearerToAnotherOrigin() async throws {
        var stored: String?
        var current = "https://a.invalid"
        var target = "https://a.invalid"
        let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 }, currentOrigin: { current })
        credentials.token = "synthetic-tenant-A-credential"
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [HeaderRecordingProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let client = APIClient(session: session, credentials: credentials, baseURL: { target })

        let _: EmptyResponse = try await client.send("api/fixture")
        // 快照取在 A，请求地址已是 B（切换与请求构造交错）。
        let owner = credentials.snapshot()
        target = "https://b.invalid"
        let _: EmptyResponse = try await client.send("api/fixture", owner: owner)
        current = "https://b.invalid"
        let _: EmptyResponse = try await client.send("api/fixture")

        XCTAssertEqual(HeaderRecordingProtocol.authorization, ["Bearer synthetic-tenant-A-credential", nil, nil])
    }

    func testMediaRequestRequiresCredentialOriginToMatch() {
        var stored: String?
        let credentials = KeychainStore(readToken: { stored }, writeToken: { stored = $0 }, currentOrigin: { "https://stale.invalid" })
        credentials.token = "synthetic-login"
        let url = URL(string: ServerConfig.shared.baseURL + "/uploads/files/a")!
        XCTAssertNil(MediaUrlResolver.request(url, owner: credentials.snapshot()).value(forHTTPHeaderField: "Authorization"))
    }
}
