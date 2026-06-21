import Foundation

/// 把后端相对资源路径（/uploads/...）解析为可被 Kingfisher/播放器加载的绝对地址。
/// 受保护的 /uploads 资源附加 ?token=（后端兜底鉴权，对齐 Web/Android 做法）。
enum MediaUrlResolver {
    static func resolve(_ url: String?) -> String? {
        guard let url, !url.isEmpty else { return url }
        if url.hasPrefix("http://") || url.hasPrefix("https://") || url.hasPrefix("data:") { return url }

        let base = ServerConfig.shared.baseURL   // 已去尾部斜杠
        var abs = url.hasPrefix("/") ? base + url : base + "/" + url

        if let token = KeychainStore.shared.token, abs.contains("/uploads/") {
            let encoded = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token
            abs += (abs.contains("?") ? "&" : "?") + "token=" + encoded
        }
        return abs
    }
}
