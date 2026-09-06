import Foundation

/// 消息搜索筛选参数（F5，对齐 Web buildMessageSearchParams / Android SearchFilterParams）：
/// 全部可选；任一非空时后端走 LIKE+条件拼接路径（可过滤媒体类型）。
struct SearchFilterParams {
    var type: String? = nil
    var fromSec: Int64? = nil
    var toSec: Int64? = nil
    var senderId: String? = nil

    var isEmpty: Bool { type == nil && fromSec == nil && toSec == nil && senderId == nil }
}

final class SearchRepository {
    static let shared = SearchRepository()
    private init() {}

    private let api = APIClient.shared

    func search(_ q: String, filters: SearchFilterParams = SearchFilterParams()) async throws -> [SearchResult] {
        var path = "api/messages/search?limit=30"
        let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        path += "&q=\(encoded)"
        if let type = filters.type { path += "&type=\(type)" }
        if let from = filters.fromSec { path += "&from=\(from)" }
        if let to = filters.toSec { path += "&to=\(to)" }
        if let sender = filters.senderId {
            let enc = sender.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? sender
            path += "&senderId=\(enc)"
        }
        let res: SearchResponse = try await api.send(path)
        return res.results
    }
}
