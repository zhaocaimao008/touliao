import Foundation
import Kingfisher

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

    /// 供 KFImage 使用：把【已解析】的绝对地址包成带稳定 cacheKey 的 Source。
    /// /uploads 地址带 ?token=<JWT>，Kingfisher 默认以完整 URL 作缓存键，token 轮换
    /// (刷新/重登)后所有头像/图片缓存全部失效→重新下载（观感/流量杀手）。这里用剥掉
    /// query 的路径作 cacheKey，令缓存跨 token 存活；真正下载仍走带 token 的原地址。
    static func kfSource(resolved s: String?) -> Source? {
        guard let s, !s.isEmpty, let u = URL(string: s) else { return nil }
        let cacheKey = s.components(separatedBy: "?").first ?? s
        return .network(ImageResource(downloadURL: u, cacheKey: cacheKey))
    }

    /// 便捷：接收【原始】路径，先 resolve 再包成带稳定 cacheKey 的 Source。
    static func kfSource(raw url: String?) -> Source? {
        kfSource(resolved: resolve(url))
    }
}
