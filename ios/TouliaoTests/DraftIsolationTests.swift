import XCTest
@testable import Touliao
final class DraftIsolationTests: XCTestCase {
    func testSwitchRestartDelayedWriteABAAndLegacyQuarantine() throws {
        let name = "social-draft-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set("unowned", forKey: "vxin_draft_group")
        let store = DraftStore(defaults: defaults)
        let a = store.activate(server: "https://one.test", accountId: "A", identityEpoch: 1)
        XCTAssertEqual(store.get("group"), "")
        store.set("group", "A private", owner: a)
        let b = store.activate(server: "https://one.test", accountId: "B", identityEpoch: 2)
        XCTAssertEqual(store.get("group"), "")
        store.set("group", "late A", owner: a)
        store.set("group", "B private", owner: b)
        let again = store.activate(server: "https://one.test", accountId: "A", identityEpoch: 3)
        store.set("group", "ABA stale", owner: a)
        XCTAssertEqual(store.get("group", owner: again), "A private")
        store.invalidate()
        XCTAssertEqual(store.get("group", owner: again), "")
        store.set("group", "after logout", owner: again)
        let restart = DraftStore(defaults: defaults)
        restart.activate(server: "https://one.test", accountId: "A", identityEpoch: 0)
        XCTAssertEqual(restart.get("group"), "A private")
        restart.activate(server: "https://two.test", accountId: "A", identityEpoch: 1)
        XCTAssertEqual(restart.get("group"), "")
        restart.activate(server: "https://one.test", accountId: "B", identityEpoch: 2)
        XCTAssertEqual(restart.get("group"), "B private")
        XCTAssertEqual(defaults.string(forKey: "vxin_draft_group"), "unowned")
    }
}
