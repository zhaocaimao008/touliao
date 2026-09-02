import Foundation

/// 消息合并纯函数集 —— 无 UIKit 依赖，XCTest 直跑。
/// 对齐 Android ChatMessageMerge.kt / Web messageSync.js 已验证语义。
///
/// 2026-09-02 从 ChatViewModel 抽取。第 1 轮为「纯抽取」（行为与抽取前完全一致，
/// 含已知两个洞），红灯用例锁定现状；第 2 轮修复两个洞：
///   洞 A（透明锚点）：pending 不参与二分比较（seqOf → nil，lowerBoundSeq 跳过），
///       真实消息恒有序；mergeServerWithPending 不再按 createdAt 与服务端混排，
///       pending 统一排末尾（createdAt 升序）。
///   洞 B（就地更新重定位）：替换/更新后相邻 seq 校验（violatesOrder），错位则取出
///       按新 seq 重插（自愈历史错位）。
///   DEBUG 有序断言：#if DEBUG 编译期裁剪，release 零开销（对齐 Android BuildConfig.DEBUG）。
///
/// pending 判定：localStatus 非空（sending/failed 本地态）或 serverSequence <= 0。
/// 生产接线：ChatViewModel 的广播/回声落地走 claimOrAppend，catchUp 走 applySyncEvents
/// （created 事件与广播共用 claimOrAppend 路径），发送 ack 落地在 ViewModel 内嵌
/// 替换 + relocate —— 三处洞 B 载体均已校验重定位。
enum ChatMessageMerge {

    /// 真实 seq：pending → nil（透明锚点），真实消息 → Int64。
    static func seqOf(_ m: Message) -> Int64? {
        (m.localStatus == nil && m.serverSequence > 0) ? m.serverSequence : nil
    }

    /// 服务端历史消息 + 本地待发(pending)合并。
    /// 洞 A 修复：不再 `(server + pending).sorted { $0.createdAt < $1.createdAt }` 混排 ——
    /// pending 的 createdAt 是客户端时钟、与服务端时间不可比，混排会把 pending 锚进数组
    /// 中间（洞 A 源头）。现语义：服务端消息保持原序（seq 序），pending 统一排末尾、
    /// 多条间按 createdAt 升序（同一客户端内时钟自洽 = 原发送先后）。
    static func mergeServerWithPending(server: [Message], pending: [Message]) -> [Message] {
        server + pending.sorted { $0.createdAt < $1.createdAt }
    }

    /// 第一个真实消息（seq 非 nil）中 server_sequence >= target 的物理下标；无 → 数组末尾。
    /// 线性 O(n)：数组物理上可能被 pending 打洞、无法直接二分；n 与既有 removeAll/firstIndex
    /// 同阶，sync 属低频路径（重连/恢复/补拉），量级可接受（对齐 Web/Android lowerBoundSeq）。
    private static func lowerBoundSeq(_ arr: [Message], _ target: Int64) -> Int {
        for (i, m) in arr.enumerated() {
            guard let s = seqOf(m) else { continue }
            if s >= target { return i }
        }
        return arr.count
    }

    /// 按 server_sequence 有序插入（洞 A 修复：pending 透明，不参与比较、槽位不被挤走）。
    /// 已存在同 id → 不动；无真实 seq → 追加末尾（防御：事件消息理论必有 seq）。
    static func insertBySeq(_ messages: [Message], _ msg: Message) -> [Message] {
        var result = messages
        guard !result.contains(where: { $0.id == msg.id }) else { return result }
        guard let seq = seqOf(msg) else { result.append(msg); return result }
        #if DEBUG
        assertSortedOrRepair(&result)
        #endif
        result.insert(msg, at: lowerBoundSeq(result, seq))
        return result
    }

    /// 洞 B：arr[idx] 与最近真实邻居逆序（历史错位）→ 取出按新 seq 重插并返回修正后数组；
    /// 未错位或非真实消息 → 原样返回。供 claimOrAppend 替换路径与 ViewModel ack 落地共用。
    static func relocate(_ arr: [Message], at idx: Int) -> [Message] {
        guard idx >= 0, idx < arr.count, violatesOrder(arr, idx) else { return arr }
        var result = arr
        let moved = result.remove(at: idx)
        result.insert(moved, at: lowerBoundSeq(result, seqOf(moved)!))
        return result
    }

    /// 批量应用 sync 事件（复刻 ChatViewModel.catchUp 语义）：
    /// 事件按 serverSequence 升序；created → claimOrAppend（乐观占位让位/就地更新 +
    /// 洞 B 校验，与广播同一路径）；edited → 就地改 content/edited（编辑不改 seq，位置不变）；
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

    /// 广播/回声消息落地（复刻 ChatViewModel.claimOrAppend 语义，去 outbox 副作用）：
    /// client_msg_id 命中乐观占位 → 去重同 id 后保留位置替换，随后相邻 seq 校验（洞 B）：
    /// pending 若曾被锚在中间/错槽，确认消息带新 seq 停错槽位则取出按新 seq 重插（自愈）；
    /// 否则按序插入/追加（洞 A）。
    static func claimOrAppend(_ messages: [Message], _ msg: Message) -> [Message] {
        var result = messages
        if let cid = msg.clientMsgId,
           let idx = result.firstIndex(where: { $0.clientMsgId == cid || $0.id == cid }) {
            // 若真实消息已因其它路径存在，先去重再替换（保留命中位置）
            result.removeAll { $0.id == msg.id && $0.clientMsgId != cid }
            if let i = result.firstIndex(where: { $0.clientMsgId == cid || $0.id == cid }) {
                result[i] = msg
                return relocate(result, at: i)
            }
            return result
        }
        return insertBySeq(result, msg)
    }

    /// 洞 B 相邻序校验（对齐 Web/Android violatesOrder）：arr[i] 与最近的真实邻居逆序 → true。
    /// O(1)（pending 数极少）。正确性依据：server_sequence 在会话内 UNIQUE，任何全局错位
    /// 必存在相邻逆序对 → 只查最近邻居即可检出，无需整段扫描。忽略 pending（不参与比较）。
    static func violatesOrder(_ arr: [Message], _ i: Int) -> Bool {
        guard i >= 0, i < arr.count, let seq = seqOf(arr[i]) else { return false }
        var l = i - 1
        while l >= 0 && seqOf(arr[l]) == nil { l -= 1 }
        if l >= 0, let ls = seqOf(arr[l]), ls > seq { return true }
        var r = i + 1
        while r < arr.count && seqOf(arr[r]) == nil { r += 1 }
        if r < arr.count, let rs = seqOf(arr[r]), rs < seq { return true }
        return false
    }

    /// DEBUG 有序断言（对齐 Web assertSortedOrRepair / Android debug 断言）：插入前校验
    /// 真实消息 seq 单调；违序 → 打印 + 降级全量修复（真实按 seq 升序、pending 排末尾）。
    /// 仅 #if DEBUG（Debug 构建）编译；release 常量折叠为零开销。
    private static func assertSortedOrRepair(_ arr: inout [Message]) {
        var prev = Int64.min
        var bad = false
        for m in arr {
            guard let s = seqOf(m) else { continue }
            if s < prev { bad = true; break }
            prev = s
        }
        if bad {
            NSLog("[ChatMessageMerge] 消息数组未按 server_sequence 有序(忽略 pending), 降级全量修复: %@",
                  arr.map { "\($0.id)(\(seqOf($0) ?? -1))" }.joined(separator: ", "))
            arr.sort { a, b in
                let sa = seqOf(a) ?? Int64.max
                let sb = seqOf(b) ?? Int64.max
                return sa == sb ? a.createdAt < b.createdAt : sa < sb
            }
        }
    }
}
