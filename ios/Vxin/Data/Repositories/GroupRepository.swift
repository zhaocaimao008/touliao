import Foundation

struct RenameGroupBody: Encodable { let name: String }
struct InviteBody: Encodable { let userIds: [String] }
private struct AnnouncementBody: Encodable { let announcement: String }
private struct NicknameBody: Encodable { let nickname: String }
private struct GroupAvatarResponse: Decodable { let avatar: String }
private struct ManageBody: Encodable {
    var mute_all: Bool?
    var no_private_chat: Bool?
    var no_add_friend: Bool?
}
private struct SetRoleBody: Encodable { let role: String }
private struct TransferOwnerBody: Encodable { let userId: String }

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

    func manage(_ conversationId: String, muteAll: Bool? = nil, noPrivateChat: Bool? = nil, noAddFriend: Bool? = nil) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/manage", method: "PUT",
            body: ManageBody(mute_all: muteAll, no_private_chat: noPrivateChat, no_add_friend: noAddFriend)
        )
    }

    func setRole(_ conversationId: String, userId: String, role: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/members/\(userId)/role", method: "PUT", body: SetRoleBody(role: role)
        )
    }

    func transferOwner(_ conversationId: String, userId: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/transfer-owner", method: "POST", body: TransferOwnerBody(userId: userId)
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

    func dissolve(_ conversationId: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/messages/conversation/\(conversationId)/dissolve", method: "POST"
        )
    }

    func qrCode(_ conversationId: String) async throws -> GroupQr {
        try await api.send("api/messages/conversation/\(conversationId)/qr-code")
    }

    func join(token: String) async throws -> JoinGroupResult {
        try await api.send("api/messages/join/\(token)", method: "POST")
    }
}
