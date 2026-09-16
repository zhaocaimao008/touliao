import XCTest
@testable import Touliao

final class OutboxIsolationTests: XCTestCase {
    func testCapacityLimitBelongsToEachOwner() throws {
        let name = "q03-capacity-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let store = OutboxStore(defaults: defaults)
        let a = OutboxOwner(server: "https://fixture.invalid", accountId: "A")
        let b = OutboxOwner(server: "https://fixture.invalid", accountId: "B")
        let bMessage = Message(optimisticText: "b1", conversationId: "group", senderId: "B", content: "B text", replyToId: nil, replyTo: nil, clientMsgId: "b1")
        store.upsert("group", bMessage, owner: b)
        for i in 0...50 {
            let message = Message(optimisticText: "m\(i)", conversationId: "group", senderId: "A", content: "A text", replyToId: nil, replyTo: nil, clientMsgId: "m\(i)")
            store.upsert("group", message, owner: a)
        }
        XCTAssertEqual(store.load("group", owner: a).count, 50)
        XCTAssertEqual(store.load("group", owner: a).first?.id, "m1")
        XCTAssertEqual(store.load("group", owner: b).first?.id, "b1")
    }
    func testOwnerServerRestartAndLegacyQuarantine() throws {
        let name = "q03-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let a = OutboxOwner(server: "https://one.test", accountId: "A")
        let b = OutboxOwner(server: "https://one.test", accountId: "B")
        let other = OutboxOwner(server: "https://two.test", accountId: "A")
        let store = OutboxStore(defaults: defaults)
        for conv in ["same-group", "dm-a-b"] {
            var message = Message(optimisticText: "m1", conversationId: conv, senderId: "A", content: "A private", replyToId: nil, replyTo: nil, clientMsgId: "m1")
            message.localStatus = LocalMsgStatus.failed
            store.upsert(conv, message, owner: a)
            XCTAssertTrue(store.load(conv, owner: b).isEmpty)
            XCTAssertTrue(store.load(conv, owner: other).isEmpty)
            XCTAssertEqual(OutboxStore(defaults: defaults).load(conv, owner: a).first?.content, "A private")
            store.remove(conv, "m1", owner: b)
            XCTAssertEqual(store.load(conv, owner: a).count, 1)
            store.remove(conv, "m1", owner: a)
            XCTAssertTrue(store.load(conv, owner: a).isEmpty)
        }
        let legacy = Data("[{\"id\":\"old\",\"conversationId\":\"group\",\"senderId\":\"A\",\"content\":\"legacy\",\"createdAt\":1}]".utf8)
        defaults.set(legacy, forKey: "vxin_outbox_group")
        XCTAssertTrue(store.load("group", owner: a).isEmpty)
        XCTAssertEqual(defaults.data(forKey: "vxin_outbox_group"), legacy)
    }
}
