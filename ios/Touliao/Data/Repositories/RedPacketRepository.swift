import Foundation

private struct SendRedPacketBody: Encodable {
    let conversationId: String
    let totalAmount: Int
    let totalCount: Int
    let greeting: String
}

final class RedPacketRepository {
    static let shared = RedPacketRepository()
    private init() {}

    private let api = APIClient.shared

    /// 发红包（服务端建红包 + 发 red_packet 消息并广播）
    func send(conversationId: String, totalAmount: Int, totalCount: Int, greeting: String) async throws -> SendRedPacketResponse {
        try await api.send(
            "api/redpackets/send", method: "POST",
            body: SendRedPacketBody(conversationId: conversationId, totalAmount: totalAmount, totalCount: totalCount, greeting: greeting)
        )
    }

    func detail(_ packetId: String) async throws -> RedPacketDetail {
        try await api.send("api/redpackets/\(packetId)")
    }

    func claim(_ packetId: String) async throws -> ClaimRedPacketResponse {
        try await api.send("api/redpackets/\(packetId)/claim", method: "POST")
    }
}
