import Foundation

struct RenameGroupBody: Encodable { let name: String }
struct InviteBody: Encodable { let userIds: [String] }

/// 群成员管理。与 Android GroupRepository 等价。
final class GroupRepository {
    static let shared = GroupRepository()
    private init() {}

    private let api = APIClient.shared

    func info(_ conversationId: String) async throws -> GroupInfo {
        try await api.send("api/messages/conversation/\(conversationId)/info")
    }

    func rename(_ conversationId: String, name: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)", method: "PUT", body: RenameGroupBody(name: name)
        )
    }

    func invite(_ conversationId: String, userIds: [String]) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/invite", method: "POST", body: InviteBody(userIds: userIds)
        )
    }

    func kick(_ conversationId: String, userId: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/members/\(userId)", method: "DELETE"
        )
    }

    func leave(_ conversationId: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/leave", method: "POST"
        )
    }
}
