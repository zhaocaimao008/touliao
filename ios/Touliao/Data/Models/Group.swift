import Foundation

struct GroupQr: Decodable {
    var qrCode: String = ""   // data:image/png;base64,...
    var url: String = ""
    var token: String = ""
}

/// POST conversation/{id}/invite-link 响应（F5 群邀请链接）：link/url 同值，url 是既有字段。
struct GroupInviteLink: Decodable {
    var token: String = ""
    var link: String = ""
    var url: String = ""
    var expiresAt: Int = 0

    /// 复制用地址：优先 url，退回 link
    var shareUrl: String { url.isEmpty ? link : url }
}

struct JoinGroupResult: Decodable {
    var success: Bool = false
    var conversationId: String = ""
    var alreadyMember: Bool = false
}

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
    var muteAll: Int = 0
    var noPrivateChat: Int = 0
    var noAddFriend: Int = 0
    var memberCanInvite: Int = 0   // 1=普通成员可邀请/生成邀请链接（决定"复制邀请链接"入口显隐）
    var members: [GroupMember] = []

    var canManage: Bool { myRole == "owner" || myRole == "admin" }
    var isOwner: Bool { myRole == "owner" }
    /// 生成邀请链接权限：群主/管理员，或群开启 member_can_invite 的普通成员（与后端 createInviteLink 同口径）
    var canCreateInviteLink: Bool { canManage || memberCanInvite == 1 }
    func myNickname(_ myId: String) -> String { members.first { $0.id == myId }?.nickname ?? "" }

    enum CodingKeys: String, CodingKey {
        case id, name, avatar, announcement, myRole, members
        case ownerId = "owner_id"
        case muteAll = "mute_all"
        case noPrivateChat = "no_private_chat"
        case noAddFriend = "no_add_friend"
        case memberCanInvite = "member_can_invite"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        announcement = (try? c.decode(String.self, forKey: .announcement)) ?? ""
        ownerId = (try? c.decode(String.self, forKey: .ownerId)) ?? ""
        myRole = (try? c.decode(String.self, forKey: .myRole)) ?? "member"
        muteAll = (try? c.decode(Int.self, forKey: .muteAll)) ?? 0
        noPrivateChat = (try? c.decode(Int.self, forKey: .noPrivateChat)) ?? 0
        noAddFriend = (try? c.decode(Int.self, forKey: .noAddFriend)) ?? 0
        memberCanInvite = (try? c.decode(Int.self, forKey: .memberCanInvite)) ?? 0
        members = (try? c.decode([GroupMember].self, forKey: .members)) ?? []
    }
}
