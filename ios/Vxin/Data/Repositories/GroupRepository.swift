import Foundation

struct RenameGroupBody: Encodable { let name: String }
struct InviteBody: Encodable { let userIds: [String] }
private struct AnnouncementBody: Encodable { let announcement: String }
private struct NicknameBody: Encodable { let nickname: String }
private struct GroupAvatarResponse: Decodable { let avatar: String }

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

    func setAnnouncement(_ conversationId: String, announcement: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)", method: "PUT", body: AnnouncementBody(announcement: announcement)
        )
    }

    func setNickname(_ conversationId: String, nickname: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/nickname", method: "PUT", body: NicknameBody(nickname: nickname)
        )
    }

    func setAvatar(_ conversationId: String, data: Data, fileName: String) async throws -> String {
        let res: GroupAvatarResponse = try await api.upload(
            "api/messages/conversation/\(conversationId)/avatar", fileData: data, fileName: fileName,
            mimeType: "image/jpeg", fieldName: "avatar", method: "PUT"
        )
        return res.avatar
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
