import Foundation

struct CollectionExtra: Decodable {
    var fileUrl: String = ""
    var sourceMsgId: String = ""
    enum CodingKeys: String, CodingKey { case fileUrl = "file_url"; case sourceMsgId = "source_msg_id" }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fileUrl = (try? c.decode(String.self, forKey: .fileUrl)) ?? ""
        sourceMsgId = (try? c.decode(String.self, forKey: .sourceMsgId)) ?? ""
    }
}

/// 收藏项（GET /api/users/me/collections）
struct Collection: Decodable, Identifiable {
    let id: String
    var type: String = "text"
    var content: String = ""
    var extra: CollectionExtra = CollectionExtra()
    var createdAt: Double = 0

    enum CodingKeys: String, CodingKey {
        case id, type, content, extra
        case createdAt = "created_at"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = (try? c.decode(String.self, forKey: .type)) ?? "text"
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        extra = (try? c.decode(CollectionExtra.self, forKey: .extra)) ?? CollectionExtra()
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
    }
}
