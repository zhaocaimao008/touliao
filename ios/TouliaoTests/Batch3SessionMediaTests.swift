import XCTest
@testable import Touliao

final class Batch3SessionMediaTests: XCTestCase {
    func testAccountAndServerScopedCacheSurvivesRestartWithoutCrossAccountReads() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var scope = "server1:A"
        let store = MsgCacheStore(directory: directory, accountScope: { scope })
        var message = Message(cachedId: "one", conversationId: "same-group", senderId: "A")
        message.content = "A-private-history"
        try store.saveBeforeCursor("same-group", [message])
        // Recreate the store: this is disk recovery, not merely a memory cache check.
        let restarted = MsgCacheStore(directory: directory, accountScope: { scope })
        XCTAssertEqual(restarted.load("same-group").first?.content, "A-private-history")
        scope = "server1:B"
        XCTAssertTrue(restarted.load("same-group").isEmpty)
        scope = "server2:A"
        XCTAssertTrue(restarted.load("same-group").isEmpty)
        scope = "server1:A"
        XCTAssertEqual(restarted.load("same-group").count, 1)
    }
    func testMediaResolverRemovesLegacyCredentialFromRelativeAndAbsolutePaths() {
        for raw in ["/uploads/files/a.mp4?token=synthetic-login", ServerConfig.shared.baseURL + "/uploads/files/a.mp4?token=synthetic-login"] {
            let resolved = MediaUrlResolver.resolve(raw)
            XCTAssertNotNil(resolved)
            XCTAssertFalse(resolved!.contains("synthetic-login"))
        }
    }
    func testMediaRequestDoesNotSendAccountTokenToAnotherOrigin() {
        var token: String? = "synthetic-login"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let request = MediaUrlResolver.request(URL(string: "https://third-party.invalid/uploads/files/a")!, owner: credentials.snapshot())
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }
}
