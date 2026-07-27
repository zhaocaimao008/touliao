import Foundation

/// 好友 —— GET /api/users/contacts
struct Contact: Decodable, Identifiable, Hashable {
    let id: String
    var username: String = ""
    var avatar: String = ""
    var bio: String = ""
    var status: String = ""
    var wechatId: String = ""
    var remark: String?
    // 特权账户专属：好友最后在线时间（Unix 秒）。非特权账户后端不返回，保持 nil。
    var lastOnlineAt: Double?

    var displayName: String { (remark?.isEmpty == false ? remark! : username) }

    enum CodingKeys: String, CodingKey {
        case id, username, avatar, bio, status, remark
        case wechatId = "wechat_id"
        case lastOnlineAt = "last_online_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        bio = (try? c.decode(String.self, forKey: .bio)) ?? ""
        status = (try? c.decode(String.self, forKey: .status)) ?? ""
        wechatId = (try? c.decode(String.self, forKey: .wechatId)) ?? ""
        remark = try? c.decode(String.self, forKey: .remark)
        lastOnlineAt = try? c.decode(Double.self, forKey: .lastOnlineAt)
    }
}

/// 搜索结果用户 —— GET /api/users/search
struct SearchUser: Decodable, Identifiable, Hashable {
    let id: String
    var username: String = ""
    var avatar: String = ""
    var bio: String = ""
    var wechatId: String = ""

    enum CodingKeys: String, CodingKey {
        case id, username, avatar, bio
        case wechatId = "wechat_id"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        bio = (try? c.decode(String.self, forKey: .bio)) ?? ""
        wechatId = (try? c.decode(String.self, forKey: .wechatId)) ?? ""
    }
}

/// 收到的好友申请 —— GET /api/users/friend-requests
struct FriendRequest: Decodable, Identifiable, Hashable {
    let id: String
    var fromId: String = ""
    var message: String = ""
    var status: String = ""
    var createdAt: Double = 0
    var username: String = ""
    var avatar: String = ""
    var wechatId: String = ""

    enum CodingKeys: String, CodingKey {
        case id, message, status, username, avatar
        case fromId = "from_id"
        case createdAt = "created_at"
        case wechatId = "wechat_id"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        fromId = (try? c.decode(String.self, forKey: .fromId)) ?? ""
        message = (try? c.decode(String.self, forKey: .message)) ?? ""
        status = (try? c.decode(String.self, forKey: .status)) ?? ""
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        wechatId = (try? c.decode(String.self, forKey: .wechatId)) ?? ""
    }
}
