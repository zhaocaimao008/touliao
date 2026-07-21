import Foundation

/// 离线消息历史缓存（iOS · FileManager JSON，每会话一文件）。
/// 契约见 docs/offline-message-cache-contract.md，语义 1:1 对齐 Web 参考实现
/// web/src/utils/msgCache.js（同款 normalize / mergeById / load / save / remove / clear）。
///
/// 定位：**首屏占位缓存，非真相源**。服务端永远是真相源；本缓存出错最坏退化为
/// 「空白等拉取」，绝不产生数据错误。任何 IO 异常一律静默降级，不影响主流程。
///
/// 只存「已被服务端确认的历史消息」(有真实 id)；未确认/失败的待发消息由 OutboxStore 负责。
/// 载体：复刻 OutboxStore 模式——`Message` 仅 Decodable，故用独立 `Cached: Codable` 快照落盘；
/// 每会话一个 JSON 文件（比 UserDefaults 适合较大历史），目录名带 schema 版本号 `v1`。
///
/// 隐私红线（各自有测试）：
///  - 阅后即焚会话（burnAfter>0）**绝不落盘**——由 ChatViewModel 跳过 save（后端 burn 为会话级）。
///  - 退出登录 / 切换账号 → clear() 全清（由 SessionStore 触发）。
final class MsgCacheStore {
    static let shared = MsgCacheStore()

    private let fm = FileManager.default
    private let dir: URL

    /// 允许测试注入独立目录，避免污染真实缓存。
    init(directory: URL? = nil) {
        if let directory {
            dir = directory
        } else {
            // Caches：系统可回收；缓存丢失最坏退化为「空白等拉取」，符合定位。
            let base = fm.urls(for: .cachesDirectory, in: .userDomainMask).first
                ?? fm.temporaryDirectory
            dir = base.appendingPathComponent("vxin_msgcache_v1", isDirectory: true)
        }
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    // MARK: - 可持久化快照（Message 仅 Decodable，落盘用独立 Codable 结构）

    struct Cached: Codable {
        let id: String
        let conversationId: String
        let senderId: String
        let type: String
        let content: String
        let fileUrl: String
        let replyToId: String?
        let createdAt: Double
        let senderName: String
        let senderAvatar: String
        let edited: Int
        let deleted: Int
    }

    // MARK: - Public（签名对齐 msgCache.js load/save/remove/clear）

    /// 读取会话缓存（最近 50，createdAt 升序）。任何异常 → 返回空。
    func load(_ conversationId: String) -> [Message] {
        guard !conversationId.isEmpty else { return [] }
        return loadItems(conversationId).map { $0.toMessage() }
    }

    /// 覆写会话缓存（内部 normalize：去乐观/待发、按 id 去重、升序、截断最近 50）。异常静默。
    func save(_ conversationId: String, _ msgs: [Message]) {
        guard !conversationId.isEmpty else { return }
        let clean = Self.normalize(msgs).map { Cached(from: $0) }
        writeItems(conversationId, clean)
    }

    /// 删除单条（撤回/删除）。
    func remove(_ conversationId: String, _ msgId: String) {
        guard !conversationId.isEmpty else { return }
        let items = loadItems(conversationId)
        let next = items.filter { $0.id != msgId }
        if next.count != items.count { writeItems(conversationId, next) }
    }

    /// 清理：有 convId=清该会话；无参=清全部（登出/切账号，隐私红线）。
    func clear(_ conversationId: String? = nil) {
        if let conversationId, !conversationId.isEmpty {
            try? fm.removeItem(at: fileURL(conversationId))
        } else {
            // 全清：删整个缓存目录再重建（登出隐私红线）。
            try? fm.removeItem(at: dir)
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    // MARK: - 纯逻辑（可 XCTest；1:1 对齐 msgCache.js）

    /// 归一化：只留有真实 id 的消息，按 createdAt 升序 + id tie-break，截断最近 50。
    /// - 无真实 id / 乐观消息(clientMsgId 或 localStatus 非空) 不入缓存；
    /// - 同 id 只留一条（后出现者覆盖，配合 mergeById 让 server 版本生效）。
    ///
    /// 关于「阅后即焚不落盘」：后端 burn-after 为**会话级**设置（conversation_settings.burn_after），
    /// 消息 DTO 无独立 burn 字段。故隐私红线在调用方（ChatViewModel）落实——burnAfter>0 的会话
    /// 直接跳过 save。此处按 Web 契约保留「乐观/无 id 消息不落盘」的最小防线。
    static func normalize(_ msgs: [Message]) -> [Message] {
        var map: [String: Message] = [:]
        var order: [String] = []                          // 保留插入序，后者覆盖同 id
        for m in msgs {
            guard !m.id.isEmpty else { continue }
            if m.clientMsgId != nil || m.localStatus != nil { continue }   // 乐观/待发不入缓存
            if map[m.id] == nil { order.append(m.id) }
            map[m.id] = m
        }
        let deduped = order.compactMap { map[$0] }
        let sorted = deduped.sorted { a, b in
            a.createdAt != b.createdAt ? a.createdAt < b.createdAt : a.id < b.id
        }
        return Array(sorted.suffix(maxPerConv))
    }

    /// dedupById：server 版本覆盖 cache 版本（解决「缓存旧、服务端已编辑」）。对齐 msgCache.js `mergeById`。
    static func mergeById(_ cached: [Message], _ server: [Message]) -> [Message] {
        var merged: [Message] = []
        for m in cached where !m.id.isEmpty && m.clientMsgId == nil { merged.append(m) }
        for m in server where !m.id.isEmpty && m.clientMsgId == nil { merged.append(m) }
        return normalize(merged)   // normalize 内「后者覆盖」→ server 覆盖 cache
    }

    private static let maxPerConv = 50

    // MARK: - Private IO

    private func fileURL(_ conversationId: String) -> URL {
        // 会话 id 可能含非法文件名字符，做百分号转义保证文件名安全。
        let safe = conversationId.addingPercentEncoding(
            withAllowedCharacters: .alphanumerics) ?? conversationId
        return dir.appendingPathComponent("\(safe).json")
    }

    private func loadItems(_ conversationId: String) -> [Cached] {
        guard let data = try? Data(contentsOf: fileURL(conversationId)) else { return [] }
        return (try? JSONDecoder().decode([Cached].self, from: data)) ?? []
    }

    private func writeItems(_ conversationId: String, _ items: [Cached]) {
        let url = fileURL(conversationId)
        if items.isEmpty {                       // 空 → 删文件（等价删除该会话键，对齐 Web）
            try? fm.removeItem(at: url)
            return
        }
        guard let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

private extension MsgCacheStore.Cached {
    init(from m: Message) {
        self.init(id: m.id, conversationId: m.conversationId, senderId: m.senderId,
                  type: m.type, content: m.content, fileUrl: m.fileUrl,
                  replyToId: m.replyToId, createdAt: m.createdAt,
                  senderName: m.senderName, senderAvatar: m.senderAvatar,
                  edited: m.edited, deleted: m.deleted)
    }

    func toMessage() -> Message {
        var m = Message(cachedId: id, conversationId: conversationId, senderId: senderId)
        m.type = type
        m.content = content
        m.fileUrl = fileUrl
        m.replyToId = replyToId
        m.createdAt = createdAt
        m.senderName = senderName
        m.senderAvatar = senderAvatar
        m.edited = edited
        m.deleted = deleted
        return m   // localStatus/clientMsgId 保持 nil：缓存皆已确认历史
    }
}
