import Foundation

/// 用户表情/贴纸 —— GET /api/stickers
struct Sticker: Decodable, Identifiable, Hashable {
    let id: String
    var url: String = ""

    enum CodingKeys: String, CodingKey { case id, url }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        url = (try? c.decode(String.self, forKey: .url)) ?? ""
    }
}
