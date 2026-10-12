import Foundation
import Kingfisher

/// Account credentials only travel in same-origin request headers. Players receive read tickets.
enum MediaUrlResolver {
    static func resolve(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return raw }
        guard let base = URL(string: ServerConfig.shared.baseURL + "/"),
              let url = URL(string: raw, relativeTo: base)?.absoluteURL,
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: true) else { return nil }
        if url.path.hasPrefix("/uploads/") { parts.queryItems = parts.queryItems?.filter { $0.name.lowercased() != "token" } }
        return parts.url?.absoluteString
    }
    static func protectedMedia(_ url: URL) -> Bool {
        guard let base = URL(string: ServerConfig.shared.baseURL) else { return false }
        return url.scheme == base.scheme && url.host == base.host && url.port == base.port && url.path.hasPrefix("/uploads/")
    }
    static func request(_ url: URL, owner: KeychainStore.Snapshot) -> URLRequest {
        var request = URLRequest(url: url)
        if protectedMedia(url), let token = owner.token, ServerConfig.origin(of: url.absoluteString) == owner.origin { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }
    /// 仅测试注入隔离传输层；生产始终是 ephemeral 配置 + 重定向去凭据。
    static var protocolClassesForTesting: [AnyClass]? { didSet { session = makeSession() } }
    private static var session = makeSession()
    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        if let protocolClassesForTesting { configuration.protocolClasses = protocolClassesForTesting }
        return URLSession(configuration: configuration, delegate: MediaRedirectDelegate(), delegateQueue: nil)
    }
    static func download(_ url: URL) async throws -> (URL, URLResponse) {
        let owner = KeychainStore.shared.snapshot()
        let result = try await session.download(for: request(url, owner: owner))
        guard KeychainStore.shared.isCurrent(owner) else {
            try? FileManager.default.removeItem(at: result.0)
            throw CancellationError()
        }
        return result
    }
    static func ticket(_ raw: String) async throws -> URL {
        guard let resolved = resolve(raw), let url = URL(string: resolved) else { throw APIError.network }
        guard protectedMedia(url) else { return url }
        let owner = KeychainStore.shared.snapshot()
        var query = URLComponents()
        query.queryItems = [URLQueryItem(name: "file", value: url.path)]
        struct Ticket: Decodable { let url: String }
        let ticket: Ticket = try await APIClient.shared.send("api/uploads/ticket?" + (query.percentEncodedQuery ?? ""), owner: owner)
        guard KeychainStore.shared.isCurrent(owner),
              let signed = URL(string: ticket.url, relativeTo: URL(string: ServerConfig.shared.baseURL))?.absoluteURL,
              protectedMedia(signed), signed.path == url.path,
              URLComponents(url: signed, resolvingAgainstBaseURL: true)?.queryItems?.contains(where: { $0.name == "token" && !($0.value ?? "").isEmpty }) == true
        else { throw APIError.unauthorized }
        return signed
    }
    static func kfSource(resolved raw: String?) -> Source? {
        guard let raw, let clean = resolve(raw), let url = URL(string: clean) else { return nil }
        return .provider(MediaProvider(url: url, owner: KeychainStore.shared.snapshot(), account: AccountStore.shared.activeId() ?? "anonymous"))
    }
    static func kfSource(raw: String?) -> Source? { kfSource(resolved: resolve(raw)) }

    /// 由原图 URL 推导服务端缩略图 URL，规则与 web/src/utils/url.js getThumbUrl 完全一致：
    /// /uploads/<dir>/<name>.<ext> → 同目录 <name>_thumb.webp；非 /uploads/ 开头、已是缩略图、
    /// 文件名不是「无点主名.字母数字扩展名」时原样返回。旧图没有缩略图会 404，调用方必须回退原图。
    static func thumbUrl(_ url: String?) -> String? {
        guard let url, url.hasPrefix("/uploads/") else { return url }
        if url.hasSuffix("_thumb.webp") { return url }
        guard let slash = url.lastIndex(of: "/") else { return url }
        let dir = url[...slash]
        let parts = url[url.index(after: slash)...].split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty,
              parts[1].allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else { return url }
        return "\(dir)\(parts[0])_thumb.webp"
    }

    /// 聊天气泡图统一的降采样处理器（气泡最大 280pt）。处理后的图在 Kingfisher 缓存里的键是
    /// 「源 cacheKey + 处理器 identifier」，按键取缓存的地方（含测试）必须带上同一个处理器。
    static let bubbleProcessor = DownsamplingImageProcessor(size: CGSize(width: 280, height: 280))

    /// 气泡图的加载源：服务端缩略图优先、原图兜底。参数是已 resolve 的绝对 URL。
    /// 缩略图推导不出来(与原图相同/为空)，或本进程已确认该缩略图不存在(旧图 404 等)时直接用原图，
    /// 不再每次气泡出现都先打一发注定失败的请求、再等兜底。
    static func bubbleSources(thumb: String?, original: String?) -> (primary: Source?, fallbacks: [Source]) {
        let originalSource = kfSource(resolved: original)
        guard let thumb, thumb != original, !isThumbMissing(thumb),
              let thumbSource = kfSource(resolved: thumb) else { return (originalSource, []) }
        return (thumbSource, [originalSource].compactMap { $0 })
    }

    private static let missingThumbLock = NSLock()
    private static var missingThumbs = Set<String>()
    static func markThumbMissing(_ absolute: String) {
        missingThumbLock.lock(); defer { missingThumbLock.unlock() }
        if missingThumbs.count >= 4096 { missingThumbs.removeAll(keepingCapacity: true) }
        missingThumbs.insert(absolute)
    }
    static func isThumbMissing(_ resolved: String) -> Bool {
        let key = resolve(resolved) ?? resolved
        missingThumbLock.lock(); defer { missingThumbLock.unlock() }
        return missingThumbs.contains(key)
    }

    private struct MediaProvider: ImageDataProvider {
        let url: URL
        let owner: KeychainStore.Snapshot
        let account: String
        var cacheKey: String { account + ":" + url.absoluteString }
        func data(handler: @escaping (Result<Data, Error>) -> Void) {
            guard KeychainStore.shared.isCurrent(owner) else { handler(.failure(CancellationError())); return }
            session.dataTask(with: request(url, owner: owner)) { data, response, error in
                guard KeychainStore.shared.isCurrent(owner) else { handler(.failure(CancellationError())); return }
                if let error { handler(.failure(error)); return }
                let isThumb = url.path.hasSuffix("_thumb.webp")
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
                    // 旧图/GIF 等没有缩略图：后端 404，云存储预签名 GET 对不存在的对象可能回 403。
                    if isThumb, let status = (response as? HTTPURLResponse)?.statusCode, [403, 404, 410].contains(status) {
                        markThumbMissing(url.absoluteString)
                    }
                    handler(.failure(APIError.network)); return
                }
                // 缩略图请求拿到 JSON/HTML(错误体或网关回退页)不是图片：直接判失败走原图，
                // 不把它交给 ImageIO 降采样(只会得到 CGImageSource -50 再失败)。
                if isThumb, let type = http.value(forHTTPHeaderField: "Content-Type")?.lowercased(),
                   type.hasPrefix("application/json") || type.hasPrefix("text/") {
                    markThumbMissing(url.absoluteString)
                    handler(.failure(APIError.network)); return
                }
                handler(.success(data))
            }.resume()
        }
    }
}
private final class MediaRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        var clean = request
        clean.setValue(nil, forHTTPHeaderField: "Authorization")
        completionHandler(clean)
    }
}
