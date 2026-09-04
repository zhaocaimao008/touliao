import Foundation
import Combine

/// 聊天仓库。与 Android ChatRepository 等价。
final class ChatRepository {
    static let shared = ChatRepository()
    private init() {}

    private let api = APIClient.shared
    private let socket = SocketService.shared

    /// 实时连接状态（供 UI 显示连接中/已连接）
    var statusPublisher: AnyPublisher<SocketStatus, Never> { socket.status.eraseToAnyPublisher() }

    /// 当前 socket 是否已连接（供失败消息自愈判断）
    var isSocketConnected: Bool { socket.status.value == .connected }

    /// 全局新消息流（各会话共用，UI 自行按 conversationId 过滤）
    var incomingPublisher: AnyPublisher<Message, Never> { socket.incoming.eraseToAnyPublisher() }
    var syncAvailablePublisher: AnyPublisher<String, Never> { socket.syncAvailable.eraseToAnyPublisher() }
    /// 超大户群降级通知（>500 在线 socket 的房间只推轻量通知，需客户端自行拉增量）
    var newMessageNotifyPublisher: AnyPublisher<NewMessageNotifyEvent, Never> { socket.newMessageNotify.eraseToAnyPublisher() }

    var typingPublisher: AnyPublisher<TypingEvent, Never> { socket.typing.eraseToAnyPublisher() }
    var readPublisher: AnyPublisher<ReadEvent, Never> { socket.read.eraseToAnyPublisher() }
    var unreadClearedPublisher: AnyPublisher<String, Never> { socket.unreadCleared.eraseToAnyPublisher() }
    var newConversationPublisher: AnyPublisher<Void, Never> { socket.newConversation.eraseToAnyPublisher() }
    var messageDeletedPublisher: AnyPublisher<String, Never> { socket.messageDeleted.eraseToAnyPublisher() }
    var messageRecalledPublisher: AnyPublisher<String, Never> { socket.messageRecalled.eraseToAnyPublisher() }
    var messageDeletedForMePublisher: AnyPublisher<String, Never> { socket.messageDeletedForMe.eraseToAnyPublisher() }
    var messageVanishedPublisher: AnyPublisher<String, Never> { socket.messageVanished.eraseToAnyPublisher() }
    var batchDeletedPublisher: AnyPublisher<[String], Never> { socket.batchDeleted.eraseToAnyPublisher() }
    var conversationClearedPublisher: AnyPublisher<String, Never> { socket.conversationCleared.eraseToAnyPublisher() }
    var reconnectedPublisher: AnyPublisher<Void, Never> { socket.reconnected.eraseToAnyPublisher() }
    var reactionPublisher: AnyPublisher<(String, [MessageReaction]), Never> { socket.reaction.eraseToAnyPublisher() }
    var redPacketClaimedPublisher: AnyPublisher<(String, String, Int), Never> { socket.redPacketClaimed.eraseToAnyPublisher() }
    var pinChangedPublisher: AnyPublisher<String, Never> { socket.pinChanged.eraseToAnyPublisher() }
    var groupGonePublisher: AnyPublisher<String, Never> { socket.groupGone.eraseToAnyPublisher() }
    var groupChangedPublisher: AnyPublisher<String, Never> { socket.groupChanged.eraseToAnyPublisher() }
    var messageEditedPublisher: AnyPublisher<(String, String, String), Never> { socket.messageEdited.eraseToAnyPublisher() }
    /// 被 @ 提及 → (conversationId, msgId)
    var mentionedPublisher: AnyPublisher<(convId: String, msgId: String), Never> { socket.mentioned.eraseToAnyPublisher() }
    /// 后台功能开关实时更新 → (群语音开, 群视频开)
    var configUpdatedPublisher: AnyPublisher<(groupVoiceCall: Bool, groupVideoCall: Bool, moments: Bool), Never> { socket.configUpdated.eraseToAnyPublisher() }

    func joinConversation(_ id: String) { socket.joinConversation(id) }
    func emitTyping(_ id: String) { socket.emitTyping(id) }
    func emitStopTyping(_ id: String) { socket.emitStopTyping(id) }

    /// 拍一拍（私聊可省略 targetId，服务端自动取对方）
    func nudge(conversationId: String, targetId: String? = nil) {
        socket.emitNudge(conversationId: conversationId, targetId: targetId)
    }

    /// 设置/清除聊天专属背景（空串=清除）
    func setConversationBackground(_ conversationId: String, background: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/background", method: "PUT", body: BackgroundBody(background: background)
        )
    }

    func loadConversations() async throws -> [Conversation] {
        try await api.send("api/messages/conversations")
    }

    func loadHistory(_ conversationId: String, before: Double? = nil) async throws -> [Message] {
        var path = "api/messages/\(conversationId)?limit=50"
        if let before { path += "&before=\(Int(before))" }
        return try await api.send(path)
    }

    func sync(_ conversationId: String, cursor: Int64, limit: Int = 500) async throws -> MessageSyncResponse {
        try await api.send("api/messages/\(conversationId)/sync?cursor=\(cursor)&limit=\(limit)")
    }

    /// 会话内消息搜索（FTS5，倒序命中）
    func searchInConversation(_ conversationId: String, q: String) async throws -> [Message] {
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? q
        return try await api.send("api/messages/conversation/\(conversationId)/search?q=\(enc)")
    }

    func sendText(conversationId: String, content: String, replyToId: String? = nil, clientMsgId: String? = nil) async -> Result<Message, Error> {
        await socket.sendMessage(conversationId: conversationId, content: content, replyToId: replyToId, clientMsgId: clientMsgId)
    }

    /// 撤回/删除消息
    func deleteMessage(_ msgId: String, forEveryone: Bool = true) async {
        let _: EmptyResponse? = try? await api.send(
            "api/messages/\(msgId)", method: "DELETE", body: DeleteMessageBody(forEveryone: forEveryone, vanish: nil, forMe: nil)
        )
    }

    /// 彻底删除不留痕迹
    func vanishMessage(_ msgId: String) async {
        let _: EmptyResponse? = try? await api.send(
            "api/messages/\(msgId)", method: "DELETE", body: DeleteMessageBody(forEveryone: false, vanish: true, forMe: nil)
        )
    }

    /// 个人删除（per-user tombstone，仅当前账号生效，对方不受影响）
    func deleteForMeMessage(_ msgId: String) async -> Bool {
        let resp: EmptyResponse? = try? await api.send(
            "api/messages/\(msgId)", method: "DELETE", body: DeleteMessageBody(forEveryone: false, vanish: nil, forMe: true)
        )
        return resp != nil
    }

    /// 表情回应(切换)
    func react(_ msgId: String, emoji: String) async -> [MessageReaction] {
        let resp: ReactResponse? = try? await api.send(
            "api/messages/\(msgId)/react", method: "POST", body: ReactBody(emoji: emoji)
        )
        return resp?.reactions ?? []
    }

    /// 上传媒体（图片/语音/文件）；返回服务端创建的消息（同时经 Socket 广播给其他端）
    /// duration：2026-08-29新增，语音/视频时长(秒)，可选，不传则服务端记0。
    func uploadMedia(conversationId: String, data: Data, fileName: String, mimeType: String, duration: Int = 0) async throws -> Message {
        try await api.upload("api/messages/\(conversationId)/upload", fileData: data, fileName: fileName, mimeType: mimeType, duration: duration)
    }

    /// 上传大文件(视频)：走磁盘流式上传，同一个后端接口，不改变协议。
    func uploadMediaFile(conversationId: String, fileURL: URL, fileName: String, mimeType: String, onProgress: (@Sendable (Double) -> Void)? = nil) async throws -> Message {
        try await api.uploadFileStream("api/messages/\(conversationId)/upload", fileURL: fileURL, fileName: fileName, mimeType: mimeType, onProgress: onProgress)
    }

    /// 标记会话已读（服务端发 message_read 给房间、sync:unread_cleared 给本人各端）
    func markRead(conversationId: String, messageId: String?) async {
        let _: EmptyResponse? = try? await api.send(
            "api/messages/conversation/\(conversationId)/read",
            method: "POST",
            body: MarkReadBody(messageId: messageId)
        )
    }

    // ── 群置顶消息 ──
    func pinMessage(conversationId: String, msgId: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/pin-message", method: "POST", body: PinMessageBody(msgId: msgId)
        )
    }

    func unpinMessage(conversationId: String, msgId: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/pin-message/\(msgId)", method: "DELETE"
        )
    }

    func pinnedMessages(conversationId: String) async throws -> [PinnedMessage] {
        try await api.send("api/messages/conversation/\(conversationId)/pinned-messages")
    }

    // ── 会话操作 ──
    func setConversationPinned(_ conversationId: String, pinned: Bool) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/pin", method: "POST", body: PinConvBody(pinned: pinned ? 1 : 0)
        )
    }

    func setConversationMuted(_ conversationId: String, muted: Bool) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/mute", method: "POST", body: MuteConvBody(muted: muted ? 1 : 0)
        )
    }

    func clearMessages(_ conversationId: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/messages", method: "DELETE"
        )
    }

    /// 标为未读（会话列表长按） */
    func markConversationUnread(_ conversationId: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/mark-unread", method: "POST"
        )
    }

    /// 阅后即焚（seconds=0 关闭）
    func setBurnAfter(_ conversationId: String, seconds: Int) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/burn-after", method: "POST", body: BurnAfterBody(seconds: seconds)
        )
    }

    /// 文件传输助手会话（获取或创建），返回 conversationId
    func fileHelper() async throws -> String {
        let res: FileHelperResponse = try await api.send("api/messages/file-helper")
        return res.conversationId
    }

    func editMessage(_ msgId: String, content: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/\(msgId)/edit", method: "PUT", body: EditBody(content: content)
        )
    }

    func forward(msgId: String, conversationIds: [String]) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/forward", method: "POST", body: ForwardBody(msgId: msgId, conversationIds: conversationIds)
        )
    }

    /// 批量撤回/删除（多选，单次≤20 条）
    func batchDelete(conversationId: String, msgIds: [String]) async throws {
        let _: BatchDeleteResponse = try await api.send(
            "api/messages/batch-delete", method: "POST",
            body: BatchDeleteBody(msgIds: msgIds, conversationId: conversationId)
        )
    }

    func collectMessage(_ msgId: String) async throws {
        let _: EmptyResponse = try await api.send("api/messages/\(msgId)/collect", method: "POST")
    }

    /// 导出会话全量聊天记录（GET .../export，响应 text/plain）。以 UTF-8 解码为字符串返回。
    func exportConversation(_ conversationId: String) async throws -> String {
        let data = try await api.fetchData("api/messages/conversation/\(conversationId)/export")
        return String(data: data, encoding: .utf8) ?? ""
    }

    // MARK: - 定时消息（对齐 Android ScheduledMessageRepository）

    /// 创建定时消息：send_at 须 ≥15分钟后、≤30天，后端再次校验。
    func scheduleMessage(conversationId: String, content: String, sendAt: TimeInterval) async throws -> ScheduledMessage {
        try await api.send(
            "api/messages/schedule", method: "POST",
            body: ScheduleMessageBody(conversation_id: conversationId, content: content, type: "text", send_at: Int(sendAt))
        )
    }

    /// 我的定时消息列表（含 pending / sent / cancelled）
    func scheduledMessages() async throws -> [ScheduledMessage] {
        try await api.send("api/messages/schedule")
    }

    /// 取消定时消息（仅本人且 pending 状态有效）
    func cancelScheduledMessage(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/messages/schedule/\(id)", method: "DELETE")
    }

    // MARK: - @我消息聚合

    /// 拉取@我消息。分页方式：offset → (createdAt, msgId) 复合游标，见 AUDIT.md 第九节
    /// "分页方式"🟡。before/beforeId 都为 nil = 首屏（最新一页）；翻下一页时带上当前
    /// 列表最后一条的 createdAt+msgId。响应类型此前和后端实际返回的对象结构不匹配
    /// （见 MentionsResponse 定义处说明），这次一并修正。
    func mentionsMe(before: Double? = nil, beforeId: String? = nil, limit: Int = 20) async throws -> MentionsResponse {
        var path = "api/messages/mentions/me?limit=\(limit)"
        if let before, let beforeId {
            path += "&before=\(before)&beforeId=\(beforeId)"
        }
        return try await api.send(path)
    }

    // MARK: - 聊天文件聚合视图

    /// 会话文件聚合分页列表（type=all|image|video|file）
    func conversationFiles(_ conversationId: String, type: String = "all", offset: Int = 0, limit: Int = 30) async throws -> ConversationFilesResponse {
        try await api.send("api/messages/conversation/\(conversationId)/files?type=\(type)&offset=\(offset)&limit=\(limit)")
    }
}

private struct MarkReadBody: Encodable { let messageId: String? }
private struct BackgroundBody: Encodable { let background: String }
private struct PinMessageBody: Encodable { let msgId: String }
private struct PinConvBody: Encodable { let pinned: Int }
private struct MuteConvBody: Encodable { let muted: Int }
private struct BurnAfterBody: Encodable { let seconds: Int }
private struct FileHelperResponse: Decodable { let conversationId: String }
private struct EditBody: Encodable { let content: String }
private struct ForwardBody: Encodable { let msgId: String; let conversationIds: [String] }
private struct DeleteMessageBody: Encodable { let forEveryone: Bool; let vanish: Bool?; let forMe: Bool? }
private struct BatchDeleteBody: Encodable { let msgIds: [String]; let conversationId: String }
private struct BatchDeleteResponse: Decodable { let success: Bool?; let deleted: Int? }
private struct ReactBody: Encodable { let emoji: String }
private struct ReactResponse: Decodable { let reactions: [MessageReaction] }
private struct ScheduleMessageBody: Encodable {
    let conversation_id: String
    let content: String
    let type: String
    let send_at: Int
}
