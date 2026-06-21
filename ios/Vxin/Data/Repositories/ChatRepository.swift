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
    var reactionPublisher: AnyPublisher<(String, [MessageReaction]), Never> { socket.reaction.eraseToAnyPublisher() }

    func joinConversation(_ id: String) { socket.joinConversation(id) }
    func emitTyping(_ id: String) { socket.emitTyping(id) }
    func emitStopTyping(_ id: String) { socket.emitStopTyping(id) }

    func loadConversations() async throws -> [Conversation] {
        try await api.send("api/messages/conversations")
    }

    func loadHistory(_ conversationId: String, before: Double? = nil) async throws -> [Message] {
        var path = "api/messages/\(conversationId)?limit=50"
        if let before { path += "&before=\(Int(before))" }
        return try await api.send(path)
    }

    func sendText(conversationId: String, content: String, replyToId: String? = nil) async -> Result<Message, Error> {
        await socket.sendMessage(conversationId: conversationId, content: content, replyToId: replyToId)
    }

    /// 撤回/删除消息
    func deleteMessage(_ msgId: String, forEveryone: Bool = true) async {
        let _: EmptyResponse? = try? await api.send(
            "api/messages/\(msgId)", method: "DELETE", body: DeleteMessageBody(forEveryone: forEveryone)
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
}

private struct MarkReadBody: Encodable { let messageId: String? }
private struct DeleteMessageBody: Encodable { let forEveryone: Bool }
private struct ReactBody: Encodable { let emoji: String }
private struct ReactResponse: Decodable { let reactions: [MessageReaction] }
