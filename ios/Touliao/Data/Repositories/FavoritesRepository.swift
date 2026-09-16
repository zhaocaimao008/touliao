import Foundation

final class FavoritesRepository {
    static let shared = FavoritesRepository(api: .shared)

    private let api: APIClient
    // Q13 全修：收藏最多 1000 条，服务端单页上限 100——只请求一次默认页时，超过 100
    // 条的旧收藏在列表/本地类型过滤里都摸不到（Android/Web 同一个洞，各端独立修）。
    private static let pageSize = 100

    init(api: APIClient) {
        self.api = api
    }

    func list() async throws -> [Collection] {
        var all: [Collection] = []
        var offset = 0
        while true {
            let page: [Collection] = try await api.send("api/users/me/collections?offset=\(offset)&limit=\(Self.pageSize)")
            all += page
            if page.count < Self.pageSize { break }
            offset += Self.pageSize
        }
        return all
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
