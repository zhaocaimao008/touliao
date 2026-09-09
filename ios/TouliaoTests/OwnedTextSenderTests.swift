import XCTest
@testable import Touliao

@MainActor
final class OwnedTextSenderTests: XCTestCase {
    func testRetryKeepsFailureAndRejectsLateACKAfterABAThenFreshActionSucceeds() async throws {
        var token: String? = "fixture-A"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let name = "q03-send-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let outbox = OutboxStore(defaults: defaults)
        let owner = OutboxOwner(server: "https://fixture.invalid", accountId: "A")
        let message = Message(optimisticText: "m1", conversationId: "group", senderId: "A", content: "A private", replyToId: nil, replyTo: nil, clientMsgId: "m1")
        outbox.upsert("group", message, owner: owner)
        let captured = credentials.snapshot()
        var events: [String] = []
        await sendOwnedText(message: message, owner: owner, credential: captured, credentials: credentials, outbox: outbox,
            send: { _ in
                XCTAssertEqual(outbox.load("group", owner: owner).count, 1)
                await Task.yield()
                credentials.beginIdentityChange()
                credentials.token = "fixture-B"
                credentials.beginIdentityChange()
                credentials.token = "fixture-A"
                return .success(message)
            }, onSuccess: { events.append($0.id) }, onFailure: { events.append("error") })
        XCTAssertTrue(events.isEmpty)
        XCTAssertEqual(outbox.load("group", owner: owner).count, 1)
        await sendOwnedText(message: message, owner: owner, credential: captured, credentials: credentials, outbox: outbox,
            send: { _ in XCTFail("Stale dispatch reached transport"); return .success(message) }, onSuccess: { _ in }, onFailure: {})
        await sendOwnedText(message: message, owner: owner, credential: credentials.snapshot(), credentials: credentials, outbox: outbox,
            send: { _ in .success(message) }, onSuccess: { events.append($0.id) }, onFailure: {})
        XCTAssertEqual(events, ["m1"])
        XCTAssertTrue(outbox.load("group", owner: owner).isEmpty)
    }

    func testSameOwnerCredentialRotationRejectsOldFailureAndAllowsNewAttempt() async throws {
        var token: String? = "fixture-A"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let old = credentials.snapshot()
        credentials.token = "fixture-new-A"
        XCTAssertEqual(old.identityEpoch, credentials.snapshot().identityEpoch)
        XCTAssertFalse(credentials.isCurrent(old))
        XCTAssertTrue(credentials.isCurrent(credentials.snapshot()))
    }
}
