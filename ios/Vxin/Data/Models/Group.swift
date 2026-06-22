import Foundation

struct GroupMember: Decodable, Identifiable, Hashable {
    let id: String
    var username: String = ""
    var avatar: String = ""
    var role: String = "member"     // owner | admin | member
    var nickname: String?

    var displayName: String { (nickname?.isEmpty == false ? nickname! : username) }

    enum CodingKeys: String, CodingKey { case id, username, avatar, role, nickname }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        role = (try? c.decode(String.self, forKey: .role)) ?? "member"
        nickname = try? c.decode(String.self, forKey: .nickname)
    }
}

/// GET conversation/{id}/info
struct GroupInfo: Decodable {
    let id: String
    var name: String = ""
    var avatar: String = ""
    var announcement: String = ""
    var ownerId: String = ""
    var myRole: String = "member"
    var members: [GroupMember] = []

    var canManage: Bool { myRole == "owner" || myRole == "admin" }
    func myNickname(_ myId: String) -> String { members.first { $0.id == myId }?.nickname ?? "" }

    enum CodingKeys: String, CodingKey {
        case id, name, avatar, announcement, myRole, members
        case ownerId = "owner_id"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        announcement = (try? c.decode(String.self, forKey: .announcement)) ?? ""
        ownerId = (try? c.decode(String.self, forKey: .ownerId)) ?? ""
        myRole = (try? c.decode(String.self, forKey: .myRole)) ?? "member"
        members = (try? c.decode([GroupMember].self, forKey: .members)) ?? []
    }
}
