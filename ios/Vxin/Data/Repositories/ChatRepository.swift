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

    /// 全局新消息流（各会话共用，UI 自行按 conversationId 过滤）
    var incomingPublisher: AnyPublisher<Message, Never> { socket.incoming.eraseToAnyPublisher() }

    var typingPublisher: AnyPublisher<TypingEvent, Never> { socket.typing.eraseToAnyPublisher() }
    var readPublisher: AnyPublisher<ReadEvent, Never> { socket.read.eraseToAnyPublisher() }
    var unreadClearedPublisher: AnyPublisher<String, Never> { socket.unreadCleared.eraseToAnyPublisher() }
    var newConversationPublisher: AnyPublisher<Void, Never> { socket.newConversation.eraseToAnyPublisher() }
    var messageDeletedPublisher: AnyPublisher<String, Never> { socket.messageDeleted.eraseToAnyPublisher() }
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

    /// 会话内消息搜索（FTS5，倒序命中）
    func searchInConversation(_ conversationId: String, q: String) async throws -> [Message] {
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? q
        return try await api.send("api/messages/conversation/\(conversationId)/search?q=\(enc)")
    }

    func sendText(conversationId: String, content: String, replyToId: String? = nil) async -> Result<Message, Error> {
        await socket.sendMessage(conversationId: conversationId, content: content, replyToId: replyToId)
    }

    /// 撤回/删除消息
    func deleteMessage(_ msgId: String, forEveryone: Bool = true) async {
        let _: EmptyResponse? = try? await api.send(
            "api/messages/\(msgId)", method: "DELETE", body: DeleteMessageBody(forEveryone: forEveryone, vanish: nil)
        )
    }

    /// 彻底删除不留痕迹
    func vanishMessage(_ msgId: String) async {
        let _: EmptyResponse? = try? await api.send(
            "api/messages/\(msgId)", method: "DELETE", body: DeleteMessageBody(forEveryone: false, vanish: true)
        )
    }

    /// 表情回应(切换)
    func react(_ msgId: String, emoji: String) async -> [MessageReaction] {
        let resp: ReactResponse? = try? await api.send(
            "api/messages/\(msgId)/react", method: "POST", body: ReactBody(emoji: emoji)
        )
        return resp?.reactions ?? []
    }

    /// 上传媒体（图片/语音/文件）；返回服务端创建的消息（同时经 Socket 广播给其他端）
    func uploadMedia(conversationId: String, data: Data, fileName: String, mimeType: String) async throws -> Message {
        try await api.upload("api/messages/\(conversationId)/upload", fileData: data, fileName: fileName, mimeType: mimeType)
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

    func collectMessage(_ msgId: String) async throws {
        let _: EmptyResponse = try await api.send("api/messages/\(msgId)/collect", method: "POST")
    }
}

private struct MarkReadBody: Encodable { let messageId: String? }
private struct BackgroundBody: Encodable { let background: String }
private struct PinMessageBody: Encodable { let msgId: String }
private struct PinConvBody: Encodable { let pinned: Int }
private struct MuteConvBody: Encodable { let muted: Int }
private struct EditBody: Encodable { let content: String }
private struct ForwardBody: Encodable { let msgId: String; let conversationIds: [String] }
private struct DeleteMessageBody: Encodable { let forEveryone: Bool; let vanish: Bool? }
private struct ReactBody: Encodable { let emoji: String }
private struct ReactResponse: Decodable { let reactions: [MessageReaction] }
