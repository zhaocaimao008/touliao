import Foundation

/// red_packet 类型消息的 content（JSON 字符串）解析结果
struct RedPacketContent: Decodable {
    let packetId: String
    let greeting: String
    let totalCount: Int
    let totalAmount: Int

    enum CodingKeys: String, CodingKey { case packetId, greeting, totalCount, totalAmount }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        packetId = (try? c.decode(String.self, forKey: .packetId)) ?? ""
        greeting = (try? c.decode(String.self, forKey: .greeting)) ?? ""
        totalCount = (try? c.decode(Int.self, forKey: .totalCount)) ?? 0
        totalAmount = (try? c.decode(Int.self, forKey: .totalAmount)) ?? 0
    }
}

struct RedPacketClaim: Decodable, Identifiable, Equatable {
    var packetId: String = ""
    var userId: String = ""
    var amount: Int = 0
    var claimedAt: Double = 0
    var username: String = ""

    var id: String { userId }

    enum CodingKeys: String, CodingKey {
        case amount, username
        case packetId = "packet_id"
        case userId = "user_id"
        case claimedAt = "claimed_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        packetId = (try? c.decode(String.self, forKey: .packetId)) ?? ""
        userId = (try? c.decode(String.self, forKey: .userId)) ?? ""
        amount = (try? c.decode(Int.self, forKey: .amount)) ?? 0
        claimedAt = (try? c.decode(Double.self, forKey: .claimedAt)) ?? 0
        username = (try? c.decode(String.self, forKey: .username)) ?? ""
    }
}

/// GET /api/redpackets/{id} 详情
struct RedPacketDetail: Decodable, Equatable {
    var id: String = ""
    var senderId: String = ""
    var senderName: String = ""
    var totalAmount: Int = 0
    var totalCount: Int = 0
    var claimedCount: Int = 0
    var greeting: String = ""
    var createdAt: Double = 0
    var claims: [RedPacketClaim] = []
    var myClaim: RedPacketClaim?

    enum CodingKeys: String, CodingKey {
        case id, greeting, senderName, claims, myClaim
        case senderId = "sender_id"
        case totalAmount = "total_amount"
        case totalCount = "total_count"
        case claimedCount = "claimed_count"
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        senderId = (try? c.decode(String.self, forKey: .senderId)) ?? ""
        senderName = (try? c.decode(String.self, forKey: .senderName)) ?? ""
        totalAmount = (try? c.decode(Int.self, forKey: .totalAmount)) ?? 0
        totalCount = (try? c.decode(Int.self, forKey: .totalCount)) ?? 0
        claimedCount = (try? c.decode(Int.self, forKey: .claimedCount)) ?? 0
        greeting = (try? c.decode(String.self, forKey: .greeting)) ?? ""
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        claims = (try? c.decode([RedPacketClaim].self, forKey: .claims)) ?? []
        myClaim = try? c.decode(RedPacketClaim.self, forKey: .myClaim)
    }
}

struct ClaimRedPacketResponse: Decodable {
    var success: Bool = false
    var amount: Int = 0

    enum CodingKeys: String, CodingKey { case success, amount }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = (try? c.decode(Bool.self, forKey: .success)) ?? false
        amount = (try? c.decode(Int.self, forKey: .amount)) ?? 0
    }
}

struct SendRedPacketResponse: Decodable {
    var packetId: String = ""
    var message: Message?
}
