import Foundation

/// contact_card 类型消息的 content（JSON 字符串）解析结果；字段与 web/Android 发送方一致。
struct ContactCardContent: Decodable {
    let uid: String
    let username: String
    let avatar: String
    let wechatId: String

    enum CodingKeys: String, CodingKey { case uid, username, avatar, wechatId = "wechat_id" }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        uid = (try? c.decode(String.self, forKey: .uid)) ?? ""
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
        avatar = (try? c.decode(String.self, forKey: .avatar)) ?? ""
        wechatId = (try? c.decode(String.self, forKey: .wechatId)) ?? ""
    }
}
