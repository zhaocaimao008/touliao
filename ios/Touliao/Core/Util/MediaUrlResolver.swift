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
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
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
