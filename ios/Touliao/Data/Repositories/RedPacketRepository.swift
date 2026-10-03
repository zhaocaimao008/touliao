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
    func send(conversationId: String, totalAmount: Int, totalCount: Int, greeting: String, owner: KeychainStore.Snapshot) async throws -> SendRedPacketResponse {
        guard KeychainStore.shared.isCurrent(owner) else { throw CancellationError() }
        let body = SendRedPacketBody(conversationId: conversationId, totalAmount: totalAmount, totalCount: totalCount, greeting: greeting)
        let payload = try JSONEncoder().encode(body)
        let scope = RequestKeys.accountScope()
        let key = RequestKeys.shared.key(scope: scope, operation: "redpacket", payload: payload)
        let result: SendRedPacketResponse = try await api.send(
            "api/redpackets/send", method: "POST",
            body: body, owner: owner, headers: ["Idempotency-Key": key]
        )
        RequestKeys.shared.complete(scope: scope, operation: "redpacket", payload: payload, key: key)
        return result
    }

    func detail(_ packetId: String) async throws -> RedPacketDetail {
        try await api.send("api/redpackets/\(packetId)")
    }

    func claim(_ packetId: String) async throws -> ClaimRedPacketResponse {
        try await api.send("api/redpackets/\(packetId)/claim", method: "POST")
    }
}
