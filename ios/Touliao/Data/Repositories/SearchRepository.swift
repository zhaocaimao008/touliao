import Foundation

final class SearchRepository {
    static let shared = SearchRepository()
    private init() {}

    private let api = APIClient.shared

    func search(_ q: String) async throws -> [SearchResult] {
        let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        let res: SearchResponse = try await api.send("api/messages/search?q=\(encoded)&limit=30")
        return res.results
    }
}
