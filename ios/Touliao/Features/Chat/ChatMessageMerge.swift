import Foundation

/// 消息合并纯函数集 —— 无 UIKit 依赖，XCTest 直跑。
/// 对齐 Android ChatMessageMerge.kt / Web messageSync.js 已验证语义。
///
/// 2026-09-02 从 ChatViewModel 抽取。第 1 轮为「纯抽取」：行为与抽取前完全一致
/// （含已知两个洞），供红灯用例锁定现状；第 2 轮再修复。
///
/// 洞 A：二分插入时 pending(serverSequence <= 0 或 localStatus 非空) 参与比较 →
///       中位探测被 pending 带偏，新消息可能插到错误位置（insertBySeq 内联二分 /
///       mergeServerWithPending createdAt 混排）。
/// 洞 B：就地替换不校验重定位 → 确认消息带新 seq 停在错槽位永续乱序
///       （claimOrAppend 认领替换、dispatchSend ack 落地替换）。
///
/// iOS 结构注意（与 Android 不同）：catchUp 与广播共用 claimOrAppend（created 事件
/// 直接进 claimOrAppend 的保留位置替换路径）→ iOS 的「apply 等价路径」同样含洞 B；
/// 因此 applySyncEvents 内部复刻现状：created → claimOrAppend 语义，而非 Android
/// 的 removeAll+重插。
enum ChatMessageMerge {

    /// 真实 seq：pending → nil（透明锚点），真实消息 → Int64。
    /// pending 判定：localStatus 非空（sending/failed 本地态）或 serverSequence <= 0。
    static func seqOf(_ m: Message) -> Int64? {
        (m.localStatus == nil && m.serverSequence > 0) ? m.serverSequence : nil
    }

    /// 服务端历史消息 + 本地待发(pending)合并。
    /// 复刻现状：按 createdAt 全排 —— pending 的 createdAt 是客户端时钟，
    /// 与服务端时间混排即洞 A 源头（保持原样待红灯锁定；第 2 轮修复）。
    static func mergeServerWithPending(server: [Message], pending: [Message]) -> [Message] {
        (server + pending).sorted { $0.createdAt < $1.createdAt }
    }

    /// 按 server_sequence 二分插入（复刻 ChatViewModel.insertBySequence 现状）：
    /// 已存在同 id → 不动；pending(seq <= 0) → 追加末尾；
    /// 否则二分（pending 参与比较即洞 A —— 第 1 轮原样保留）。
    static func insertBySeq(_ messages: [Message], _ msg: Message) -> [Message] {
        var result = messages
        guard !result.contains(where: { $0.id == msg.id }) else { return result }
        let seq = msg.serverSequence
        if seq <= 0 { result.append(msg); return result }
        var lo = 0, hi = result.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if result[mid].serverSequence < seq { lo = mid + 1 } else { hi = mid }
        }
        result.insert(msg, at: lo)
        return result
    }

    /// 批量应用 sync 事件（复刻 ChatViewModel.catchUp 循环现状）：
    /// 事件按 serverSequence 升序；created → claimOrAppend 语义（保留位置替换 =
    /// 洞 B 所在，与广播同一路径）；edited → 就地改 content/edited；
    /// recalled/deleted/vanished → 移除。
    static func applySyncEvents(_ messages: [Message], _ events: [ConversationEvent]) -> [Message] {
        var result = messages
        for event in events.sorted(by: { $0.serverSequence < $1.serverSequence }) {
            switch event.eventType {
            case "message_created":
                if let message = event.message { result = claimOrAppend(result, message) }
            case "message_edited":
                if let index = result.firstIndex(where: { $0.id == event.messageId }) {
                    result[index].content = event.payload["content"] ?? result[index].content
                    result[index].edited = 1
                }
            case "message_recalled", "message_deleted_for_me", "message_vanished":
                result.removeAll { $0.id == event.messageId }
            default:
                break
            }
        }
        return result
    }

    /// 广播/回声消息落地（复刻 ChatViewModel.claimOrAppend 现状，去 outbox 副作用）：
    /// client_msg_id 命中乐观占位 → 去重同 id 后保留位置替换（洞 B 所在）；
    /// 否则按序插入/追加。
    static func claimOrAppend(_ messages: [Message], _ msg: Message) -> [Message] {
        var result = messages
        if let cid = msg.clientMsgId,
           let idx = result.firstIndex(where: { $0.clientMsgId == cid || $0.id == cid }) {
            // 若真实消息已因其它路径存在，先去重再替换（保留命中位置）
            result.removeAll { $0.id == msg.id && $0.clientMsgId != cid }
            if let i = result.firstIndex(where: { $0.clientMsgId == cid || $0.id == cid }) {
                result[i] = msg
            }
            return result
        }
        return insertBySeq(result, msg)
    }
}
