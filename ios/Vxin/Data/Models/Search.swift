import Foundation

/// 全局搜索结果项 —— GET /api/messages/search
struct SearchResult: Decodable, Identifiable, Hashable {
    let id: String
    var conversationId: String = ""
    var senderId: String = ""
    var content: String = ""
    var createdAt: Double = 0
    var senderName: String = ""
    var convName: String = ""
    var convType: String = "private"
    /// 私聊搜索结果携带的对端信息(后端 searchGlobal 返回 otherUser)；用于从搜索进私聊时可拨号。
    var otherUserId: String?

    enum CodingKeys: String, CodingKey {
        case id, content, senderName, convName, convType, otherUser
        case conversationId = "conversation_id"
        case senderId = "sender_id"
        case createdAt = "created_at"
    }

    private struct OtherUserDTO: Decodable { let id: String }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        conversationId = (try? c.decode(String.self, forKey: .conversationId)) ?? ""
        senderId = (try? c.decode(String.self, forKey: .senderId)) ?? ""
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        senderName = (try? c.decode(String.self, forKey: .senderName)) ?? ""
        convName = (try? c.decode(String.self, forKey: .convName)) ?? ""
        convType = (try? c.decode(String.self, forKey: .convType)) ?? "private"
        otherUserId = (try? c.decode(OtherUserDTO.self, forKey: .otherUser))?.id
    }
}

struct SearchResponse: Decodable {
    var results: [SearchResult] = []
    var total: Int = 0
}
