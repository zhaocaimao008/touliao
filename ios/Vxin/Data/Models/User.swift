import Foundation

/// 用户模型 —— 对齐后端 getMe 返回字段（与 Android 一致）
struct User: Codable, Identifiable, Equatable {
    let id: String
    let username: String
    var phone: String = ""
    var avatar: String = ""
    var bio: String = ""
    var wechatId: String = ""
    var coverPhoto: String = ""

    enum CodingKeys: String, CodingKey {
        case id, username, phone, avatar, bio
        case wechatId = "wechat_id"
        case coverPhoto = "cover_photo"
    }
}
