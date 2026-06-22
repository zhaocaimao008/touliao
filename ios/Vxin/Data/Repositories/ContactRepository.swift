import Foundation

struct FriendRequestBody: Encodable { let toId: String; let message: String }
struct HandleRequestBody: Encodable { let action: String }
struct SendRequestResponse: Decodable { let success: Bool?; let autoAccepted: Bool? }
struct CreatePrivateBody: Encodable { let userId: String }
struct CreateGroupBody: Encodable { let name: String; let memberIds: [String] }
struct CreateConversationResponse: Decodable { let conversationId: String; let groupNumber: String? }
private struct RemarkBody: Encodable { let remark: String }

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

    func handleRequest(id: String, accept: Bool) async throws {
        let _: EmptyResponse = try await api.send(
            "api/users/friend-request/\(id)/handle", method: "POST",
            body: HandleRequestBody(action: accept ? "accept" : "reject")
        )
    }

    /// 创建/获取私聊会话，返回 conversationId
    func createPrivate(userId: String) async throws -> String {
        let res: CreateConversationResponse = try await api.send(
            "api/messages/conversation/private", method: "POST", body: CreatePrivateBody(userId: userId)
        )
        return res.conversationId
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
}
