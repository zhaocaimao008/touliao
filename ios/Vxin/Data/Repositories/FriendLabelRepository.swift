import Foundation

struct LabelMember: Decodable, Identifiable, Equatable {
    let id: String
    var username: String = ""
    var avatar: String = ""
}

struct FriendLabel: Decodable, Identifiable, Equatable {
    let id: String
    var name: String = ""
    var color: String = "#07C160"
    var members: [LabelMember] = []
}

private struct LabelBody: Encodable { let name: String; let color: String? }
private struct LabelMemberBody: Encodable { let friendId: String }

/// 好友标签/分组。
final class FriendLabelRepository {
    static let shared = FriendLabelRepository()
    private init() {}
    private let api = APIClient.shared

    func list() async throws -> [FriendLabel] { try await api.send("api/friend-labels") }
    func create(name: String, color: String? = nil) async throws -> FriendLabel {
        try await api.send("api/friend-labels", method: "POST", body: LabelBody(name: name, color: color))
    }
    func delete(_ id: String) async throws {
        let _: EmptyResponse? = try? await api.send("api/friend-labels/\(id)", method: "DELETE")
    }
    func addMember(_ id: String, friendId: String) async throws -> FriendLabel {
        try await api.send("api/friend-labels/\(id)/members", method: "POST", body: LabelMemberBody(friendId: friendId))
    }
    func removeMember(_ id: String, friendId: String) async throws {
        let _: EmptyResponse? = try? await api.send("api/friend-labels/\(id)/members/\(friendId)", method: "DELETE")
    }
}
