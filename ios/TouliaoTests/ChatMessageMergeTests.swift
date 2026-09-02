import XCTest
@testable import Touliao

/// ChatMessageMerge 纯函数红灯用例 —— 对齐 Android ChatMessageMergeTest / Web messageSync.test.js。
///
/// 第 1 轮（纯抽取）预期：2 绿 2 红
///   绿1 尾部 pending 保持位置（真实消息序不被破坏）
///   绿2 乐观占位替换不双显（claimOrAppend 认领后单条真实消息）
///   红1 洞 A：中间 pending 使二分中位探测右跳 → 新消息插错位置（真实序乱）
///   红2 洞 B：claimOrAppend 保留位置替换 → 确认消息带新 seq 停在错槽位（真实序乱）
final class ChatMessageMergeTests: XCTestCase {

    // ── 构造辅助 ──────────────────────────────────────────────
    private func m(_ id: Int, seq: Int64, cid: String? = nil,
                   local: String? = nil, createdAt: Double = 0) -> Message {
        var msg = Message(cachedId: "\(id)", conversationId: "c1", senderId: "u1")
        msg.content = "m\(id)"
        msg.createdAt = createdAt
        msg.serverSequence = seq
        msg.clientMsgId = cid
        msg.localStatus = local
        return msg
    }

    private func createdEvent(_ seq: Int64, _ message: Message) -> ConversationEvent {
        ConversationEvent(serverSequence: seq, eventType: "message_created",
                          messageId: message.id, message: message,
                          payload: [:], batchId: nil, clientBatchId: nil)
    }

    /// pending 判定与实现一致：localStatus 非空 或 serverSequence <= 0
    private func realMsgs(_ list: [Message]) -> [Message] {
        list.filter { ChatMessageMerge.seqOf($0) != nil }
    }

    /// 核心不变式：过滤 pending 后，真实消息必须严格按 server_sequence 升序
    private func assertRealSeqAscending(_ list: [Message], file: StaticString = #filePath, line: UInt = #line) {
        let seqs = realMsgs(list).map { $0.serverSequence }
        XCTAssertEqual(seqs, seqs.sorted(), "真实消息必须按 server_sequence 升序: \(seqs)", file: file, line: line)
    }

    // ── 用例 ──────────────────────────────────────────────────
    func testTailPendingKeepsPositionAndRealOrder() {
        let m1 = m(1, seq: 1, createdAt: 100)
        let m2 = m(2, seq: 2, createdAt: 200)
        let p = m(3, seq: 0, cid: "C1", local: LocalMsgStatus.failed, createdAt: 300)   // 尾部 pending
        let new3 = m(4, seq: 3, createdAt: 400)

        let result = ChatMessageMerge.insertBySeq([m1, m2, p], new3)

        XCTAssertEqual(result.count, 4)
        XCTAssertTrue(result.contains { $0.id == p.id }, "pending 不得丢失")
        assertRealSeqAscending(result)
    }

    func testOptimisticClaimReplacesWithoutDuplicate() {
        let m1 = m(1, seq: 1)
        let p = m(2, seq: 0, cid: "C1", local: LocalMsgStatus.sending)
        let real = m(3, seq: 2, cid: "C1")   // 服务端回声：同 client_msg_id、真实 id/seq

        let result = ChatMessageMerge.claimOrAppend([m1, p], real)

        XCTAssertEqual(result.count, 2)
        XCTAssertTrue(result.contains { $0.id == real.id })
        XCTAssertTrue(result.allSatisfy { $0.id != p.id }, "乐观占位已让位")
        XCTAssertEqual(result.filter { $0.id == real.id }.count, 1, "真实消息不得双显")
        assertRealSeqAscending(result)
    }

    /// 洞 A：中间 pending（createdAt 混排产物）使二分中位探测右跳，新消息插到错误位置
    func testMidPendingBreaksBinaryInsert() {
        // p(seq0) 卡在 m2 与 m3 之间（mergeServerWithPending 按 createdAt 混排的典型结果）
        let m1 = m(1, seq: 1)
        let m2 = m(2, seq: 3)
        let p = m(3, seq: 0, cid: "C1", local: LocalMsgStatus.failed)
        let m3 = m(4, seq: 4)
        let new2 = m(5, seq: 2)   // 真实槽位在 m1 与 m2 之间

        let result = ChatMessageMerge.insertBySeq([m1, m2, p, m3], new2)

        // 红（现状）：二分 mid 先探到 p(0<2) → lo 右跳 → new2 插到 m2 后 → 真实序 [1,3,2,4]
        assertRealSeqAscending(result)
    }

    /// 洞 B：回声/确认保留位置替换（claimOrAppend），确认消息带新 seq 停在错槽位
    func testEchoReplacesPendingInPlaceWithoutRelocation() {
        // m2(seq3) 为对端消息先显示；本地失败消息 p 停尾部；服务端其实先落库了 p 的确认
        // （seq2，应插 m1 与 m2 之间），echo 到达时按 client_msg_id 认领替换但保留尾部位置。
        let m1 = m(1, seq: 1)
        let m2 = m(2, seq: 3)
        let p = m(3, seq: 0, cid: "C1", local: LocalMsgStatus.failed)
        let echo = m(4, seq: 2, cid: "C1")   // 服务端确认回声：真实 seq=2

        let result = ChatMessageMerge.claimOrAppend([m1, m2, p], echo)

        // 红（现状）：替换后 [m1(1), m2(3), r(2)] —— 真实序 [1,3,2] 永续乱序（catchUp 同 id 就地更新也不修）
        assertRealSeqAscending(result)
    }
}
