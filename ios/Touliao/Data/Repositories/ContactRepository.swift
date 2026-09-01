import Foundation
import Combine

struct FriendRequestBody: Encodable { let toId: String; let message: String }
struct HandleRequestBody: Encodable { let action: String }
struct SendRequestResponse: Decodable { let success: Bool?; let autoAccepted: Bool? }
struct CreatePrivateBody: Encodable { let userId: String }
struct CreateGroupBody: Encodable { let name: String; let memberIds: [String] }
struct CreateConversationResponse: Decodable { let conversationId: String; let groupNumber: String? }
private struct RemarkBody: Encodable { let remark: String }

struct SentRequest: Decodable, Identifiable {
    let id: String
    var status: String = ""
    var message: String = ""
    var username: String = ""
    var avatar: String = ""
    enum CodingKeys: String, CodingKey { case id, status, message, username, avatar }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = (try? c.decode(String.self, forKey: .status)) ?? ""
        message = (try? c.decode(String.self, forKey: .message)) ?? ""
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
    }
}

struct BlockedUser: Decodable, Identifiable {
    let id: String
    var username: String = ""
    var avatar: String = ""
    enum CodingKeys: String, CodingKey { case id, username, avatar }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
    }
}

/// AI 助手（天问/Hermes 等机器人账号，数据来自后端 GET /api/config → features.aiAssistants）
struct AiAssistant: Decodable, Identifiable {
    let id: String
    var name: String = ""
    var username: String = ""
    var wechat_id: String = ""
    var avatar: String = ""
    var provider: String = ""
    var description: String = ""
    enum CodingKeys: String, CodingKey { case id, name, username, wechat_id, avatar, provider, description }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        wechat_id = (try? c.decode(String.self, forKey: .wechat_id)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        provider = (try? c.decode(String.self, forKey: .provider)) ?? ""
        description = (try? c.decode(String.self, forKey: .description)) ?? ""
    }
}

private struct ConfigResponse: Decodable {
    struct Features: Decodable { let aiAssistants: [AiAssistant]? }
    let features: Features?
}

/// 联系人/好友/会话创建。与 Android ContactRepository 等价。
final class ContactRepository {
    static let shared = ContactRepository()
    private init() {}

    private let api = APIClient.shared

    func contacts() async throws -> [Contact] {
        try await api.send("api/users/contacts")
    }

    func search(_ q: String) async throws -> [SearchUser] {
        let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        return try await api.send("api/users/search?q=\(encoded)")
    }

    func sendFriendRequest(toId: String, message: String = "") async throws -> SendRequestResponse {
        try await api.send("api/users/friend-request", method: "POST", body: FriendRequestBody(toId: toId, message: message))
    }

    func receivedRequests() async throws -> [FriendRequest] {
        try await api.send("api/users/friend-requests")
    }

    func sentRequests() async throws -> [SentRequest] {
        try await api.send("api/users/friend-requests/sent")
    }

    var friendEventsPublisher: AnyPublisher<Void, Never> { SocketService.shared.friendEvents.eraseToAnyPublisher() }
    var presencePublisher: AnyPublisher<(String, Bool), Never> { SocketService.shared.presence.eraseToAnyPublisher() }

    func handleRequest(id: String, accept: Bool) async throws {
        let _: EmptyResponse = try await api.send(
            "api/users/friend-request/\(id)/handle", method: "POST",
            body: HandleRequestBody(action: accept ? "accepted" : "rejected")
        )
    }

    /// 创建/获取私聊会话，返回 conversationId
    func createPrivate(userId: String) async throws -> String {
        let res: CreateConversationResponse = try await api.send(
            "api/messages/conversation/private", method: "POST",
            body: CreatePrivateBody(userId: userId))
        return res.conversationId
    }

    /// AI 助手入口列表（来自 /api/config，与后端 .env botId 联动）
    func fetchAiAssistants() async throws -> [AiAssistant] {
        let cfg: ConfigResponse = try await api.send("api/config")
        return cfg.features?.aiAssistants ?? []
    }

    /// 创建群聊，返回 conversationId
    func createGroup(name: String, memberIds: [String]) async throws -> String {
        let res: CreateConversationResponse = try await api.send(
            "api/messages/conversation/group", method: "POST", body: CreateGroupBody(name: name, memberIds: memberIds)
        )
        return res.conversationId
    }

    // ── 好友管理：删除/备注/拉黑 ──
    func deleteContact(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/users/contacts/\(id)", method: "DELETE")
    }

    func setRemark(_ id: String, remark: String) async throws {
        let _: EmptyResponse = try await api.send("api/users/contacts/\(id)/remark", method: "PUT", body: RemarkBody(remark: remark))
    }

    func block(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/users/block/\(id)", method: "POST")
    }

    func unblock(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/users/block/\(id)", method: "DELETE")
    }

    func listBlocked() async throws -> [BlockedUser] {
        try await api.send("api/users/me/blocked")
    }

    /// 用户详情（含好友关系状态），用于扫码/搜索后先展示资料卡再决定是否发送申请
    func getUserDetail(_ id: String) async throws -> UserDetail {
        try await api.send("api/users/\(id)")
    }
}
