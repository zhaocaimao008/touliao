import XCTest
@testable import Touliao

private actor PushTestGate {
    private var waiting: CheckedContinuation<Void, Never>?
    private var opened = false
    func wait() async {
        if opened { return }
        await withCheckedContinuation { waiting = $0 }
    }
    func open() { opened = true; waiting?.resume(); waiting = nil }
}

private actor PushTestEvents {
    var values: [String] = []
    func append(_ value: String) { values.append(value) }
}

final class PushAccountIsolationTests: XCTestCase {
    func testStaleOwnedRequestCannotUseNextAccountOrABA() async {
        for aba in [false, true] {
            var token: String? = "A"
            let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
            let owner = credentials.snapshot()
            credentials.token = "B"
            if aba { credentials.token = "A" }
            let api = APIClient(credentials: credentials, baseURL: { XCTFail("Stale request reached URL builder"); return "https://fixture.invalid" })
            do {
                let _: EmptyResponse = try await api.send("api/notifications/device-token", method: "DELETE", owner: owner)
                XCTFail("Expected stale request rejection")
            } catch is CancellationError {} catch { XCTFail("Unexpected error: \(error)") }
            XCTAssertEqual(credentials.token, aba ? "A" : "B")
        }
    }

    func testSwitchDrainsInflightRegistrationAndRejectsOldGeneration() async {
        var token: String? = "A"
        let credentials = KeychainStore(readToken: { token }, writeToken: { token = $0 })
        let queue = PushRegistrationQueue(credentials: credentials)
        let owner = credentials.snapshot()
        let gate = PushTestGate()
        let events = PushTestEvents()
        let started = expectation(description: "registration started")
        let registration = Task {
            await queue.run(owner: owner) {
                await events.append("register-start")
                started.fulfill()
                await gate.wait()
                await events.append("register-end")
            }
        }
        await fulfillment(of: [started], timeout: 3)
        credentials.beginIdentityChange()
        let cleanupOwner = credentials.snapshot()
        let cleanup = Task { await queue.run(owner: cleanupOwner) { await events.append("delete-A") } }
        await gate.open()
        await registration.value
        await cleanup.value
        await queue.run(owner: owner) { XCTFail("Stale register ran") }
        credentials.token = "B"
        await queue.run(owner: credentials.snapshot()) { await events.append("register-B") }
        let actual = await events.values
        XCTAssertEqual(actual, ["register-start", "register-end", "delete-A", "register-B"])
    }

    func testNotificationRecipientMustMatchCurrentAccount() {
        XCTAssertTrue(PushRecipient.matches("A", currentUserId: "A", loggedIn: true))
        XCTAssertFalse(PushRecipient.matches("A", currentUserId: "B", loggedIn: true))
        XCTAssertFalse(PushRecipient.matches("A", currentUserId: "A", loggedIn: false))
        XCTAssertFalse(PushRecipient.matches(nil, currentUserId: "A", loggedIn: true))
        XCTAssertFalse(PushRecipient.matches("", currentUserId: "", loggedIn: true))
    }
}
