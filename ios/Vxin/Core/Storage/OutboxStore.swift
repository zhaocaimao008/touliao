import Foundation

/// 失败消息「待发件箱」——让发送失败的文本消息在切走会话 / 杀进程重启后依然不丢失，
/// 对齐 Web / Android 的 outbox 体验。按 conversationId 持久化到 UserDefaults。
/// 只存纯文本（type=="text"）；每会话最多 50 条防膨胀。
final class OutboxStore {
    static let shared = OutboxStore()
    private init() {}

    private let prefix = "vxin_outbox_"
    private let maxPerConv = 50

    /// 可持久化的失败消息快照（Message 仅 Decodable，这里用独立 Codable 结构）
    private struct Item: Codable {
        let id: String
        let conversationId: String
        let senderId: String
        let content: String
        let replyToId: String?
        let createdAt: Double
        let replyToSenderName: String?
        let replyToId2: String?
        let replyToType: String?
        let replyToContent: String?
    }

    // MARK: - Public

    /// 读取某会话的待发件箱，还原为 failed 态的 Message 列表
    func load(_ conversationId: String) -> [Message] {
        loadItems(conversationId).map { item in
            let reply: ReplyPreview? = item.replyToId2.map {
                ReplyPreview(id: $0, type: item.replyToType ?? "text",
                             content: item.replyToContent ?? "", senderName: item.replyToSenderName ?? "")
            }
            var m = Message(optimisticText: item.id, conversationId: item.conversationId,
                            senderId: item.senderId, content: item.content,
                            replyToId: item.replyToId, replyTo: reply, clientMsgId: item.id)
            m.localStatus = LocalMsgStatus.failed
            m.createdAt = item.createdAt
            return m
        }
    }

    /// 新增/更新一条失败消息（按 id 去重；仅文本）
    func upsert(_ conversationId: String, _ msg: Message) {
        guard !conversationId.isEmpty, msg.type == "text" else { return }
        var items = loadItems(conversationId)
        let item = Item(
            id: msg.id, conversationId: conversationId, senderId: msg.senderId,
            content: msg.content, replyToId: msg.replyToId, createdAt: msg.createdAt,
            replyToSenderName: msg.replyTo?.senderName, replyToId2: msg.replyTo?.id,
            replyToType: msg.replyTo?.type, replyToContent: msg.replyTo?.content
        )
        if let idx = items.firstIndex(where: { $0.id == msg.id }) { items[idx] = item }
        else { items.append(item) }
        save(conversationId, Array(items.suffix(maxPerConv)))
    }

    /// 消息成功送达后移除（按 id）
    func remove(_ conversationId: String, _ msgId: String) {
        guard !conversationId.isEmpty else { return }
        let items = loadItems(conversationId)
        let next = items.filter { $0.id != msgId }
        if next.count != items.count { save(conversationId, next) }
    }

    // MARK: - Private

    private func loadItems(_ conversationId: String) -> [Item] {
        guard let data = UserDefaults.standard.data(forKey: prefix + conversationId) else { return [] }
        return (try? JSONDecoder().decode([Item].self, from: data)) ?? []
    }

    private func save(_ conversationId: String, _ items: [Item]) {
        let key = prefix + conversationId
        if items.isEmpty { UserDefaults.standard.removeObject(forKey: key); return }
        if let data = try? JSONEncoder().encode(items) { UserDefaults.standard.set(data, forKey: key) }
    }
}
