import Foundation

final class FavoritesRepository {
    static let shared = FavoritesRepository()
    private init() {}

    private let api = APIClient.shared

    func list() async throws -> [Collection] {
        try await api.send("api/users/me/collections")
    }

    /// 搜索收藏（关键词 + 可选类型过滤）
    func search(q: String, type: String? = nil, limit: Int = 50) async throws -> [Collection] {
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? q
        var path = "api/users/me/collections/search?q=\(enc)&limit=\(limit)"
        if let t = type, !t.isEmpty { path += "&type=\(t)" }
        let page: CollectionPage = try await api.send(path)
        return page.items
    }

    func remove(_ id: String) async throws {
        let _: EmptyResponse = try await api.send("api/users/me/collections/\(id)", method: "DELETE")
    }
}
