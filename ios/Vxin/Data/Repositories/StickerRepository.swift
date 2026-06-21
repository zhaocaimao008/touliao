import Foundation

private struct StickerSendBody: Encodable { let conversationId: String; let stickerId: String }
private struct StickerCollectBody: Encodable { let url: String }

final class StickerRepository {
    static let shared = StickerRepository()
    private init() {}

    private let api = APIClient.shared

    func list() async throws -> [Sticker] {
        try await api.send("api/stickers")
    }

    /// 发送表情(服务端建 image 消息并广播),返回该消息
    func send(conversationId: String, stickerId: String) async throws -> Message {
        try await api.send("api/stickers/send", method: "POST", body: StickerSendBody(conversationId: conversationId, stickerId: stickerId))
    }

    /// 收藏一张已有图片为表情
    func collect(url: String) async {
        let _: EmptyResponse? = try? await api.send("api/stickers/collect", method: "POST", body: StickerCollectBody(url: url))
    }
}
