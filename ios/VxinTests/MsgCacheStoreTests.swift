import XCTest
@testable import Vxin

/// 离线消息历史缓存 —— 语义基线，1:1 对齐 Web web/src/utils/msgCache.test.js 与 Android MsgCacheStoreTest。
/// 覆盖纯逻辑 normalize/mergeById（save/load/remove 的语义内核）+ FileManager IO 往返（用临时目录，不污染真实缓存）。
final class MsgCacheStoreTests: XCTestCase {

    private var store: MsgCacheStore!
    private var tmpDir: URL!

    override func setUpWithError() throws {
        tmpDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("msgcache_test_\(UUID().uuidString)", isDirectory: true)
        store = MsgCacheStore(directory: tmpDir)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tmpDir)
    }

    // 与 Web M(id) 等价：content=c<id>，createdAt=id。
    private func m(_ id: Int, createdAt: Double? = nil, content: String? = nil,
                   clientMsgId: String? = nil, localStatus: String? = nil) -> Message {
        var msg = Message(cachedId: "\(id)", conversationId: "c1", senderId: "u")
        msg.content = content ?? "c\(id)"
        msg.createdAt = createdAt ?? Double(id)
        msg.clientMsgId = clientMsgId
        msg.localStatus = localStatus
        return msg
    }

    private func ids(_ list: [Message]) -> [Int] { list.map { Int($0.id)! } }

    // MARK: - normalize（纯逻辑）

    func testSortAscending() {
        XCTAssertEqual(ids(MsgCacheStore.normalize([m(2), m(1), m(3)])), [1, 2, 3])
    }

    func testTruncateToRecent50() {
        let many = (1...70).map { m($0) }
        let got = MsgCacheStore.normalize(many)
        XCTAssertEqual(got.count, 50)
        XCTAssertEqual(Int(got.first!.id), 21)   // 最近 50 → 21..70
        XCTAssertEqual(Int(got.last!.id), 70)
    }

    func testDedupByIdLastWins() {
        let got = MsgCacheStore.normalize([m(1), m(1, content: "dup"), m(2)])
        XCTAssertEqual(ids(got), [1, 2])
        XCTAssertEqual(got.first { $0.id == "1" }?.content, "dup")
    }

    func testOptimisticExcluded() {
        let got = MsgCacheStore.normalize([m(1), m(2, clientMsgId: "t2"), m(3, localStatus: "sending")])
        XCTAssertEqual(ids(got), [1])
    }

    func testEmptyIdExcluded() {
        var empty = Message(cachedId: "", conversationId: "c1", senderId: "u")
        empty.createdAt = 5
        let got = MsgCacheStore.normalize([m(1), empty])
        XCTAssertEqual(ids(got), [1])
    }

    func testTieBreakById() {
        let got = MsgCacheStore.normalize([m(3, createdAt: 5), m(1, createdAt: 5), m(2, createdAt: 5)])
        XCTAssertEqual(ids(got), [1, 2, 3])
    }

    // MARK: - mergeById（server 覆盖 cache）

    func testMergeServerOverridesCache() {
        let cached = [m(1, content: "旧"), m(2)]
        let server = [m(1, content: "新(已编辑)"), m(3)]
        let merged = MsgCacheStore.mergeById(cached, server)
        XCTAssertEqual(ids(merged), [1, 2, 3])
        XCTAssertEqual(merged.first { $0.id == "1" }?.content, "新(已编辑)")
    }

    func testMergeTruncatesAndDropsOptimistic() {
        let cached = (1...40).map { m($0) }
        let server = (30...69).map { m($0) } + [m(999, clientMsgId: "t")]
        let merged = MsgCacheStore.mergeById(cached, server)
        XCTAssertLessThanOrEqual(merged.count, 50)
        XCTAssertFalse(merged.contains { $0.clientMsgId != nil })
        XCTAssertFalse(merged.contains { $0.id == "999" })
    }

    // MARK: - FileManager IO 往返

    func testSaveLoadRoundTrip() {
        store.save("c1", [m(2), m(1), m(3)])
        XCTAssertEqual(ids(store.load("c1")), [1, 2, 3])
    }

    func testSaveEmptyDeletesFile() {
        store.save("c1", [m(1)])
        store.save("c1", [])
        XCTAssertTrue(store.load("c1").isEmpty)
    }

    func testRemoveSingle() {
        store.save("c1", [m(1), m(2), m(3)])
        store.remove("c1", "2")
        XCTAssertEqual(ids(store.load("c1")), [1, 3])
    }

    func testClearConvOnly() {
        store.save("c1", [m(1)])
        store.save("c2", [m(9)])
        store.clear("c1")
        XCTAssertTrue(store.load("c1").isEmpty)
        XCTAssertEqual(ids(store.load("c2")), [9])
    }

    func testClearAllOnLogout() {
        store.save("c1", [m(1)])
        store.save("c2", [m(9)])
        store.clear()
        XCTAssertTrue(store.load("c1").isEmpty)
        XCTAssertTrue(store.load("c2").isEmpty)
    }

    func testEmptyConvIdSafe() {
        XCTAssertTrue(store.load("").isEmpty)
        store.save("", [m(1)])   // 不崩溃即可
    }
}
