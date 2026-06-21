import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case server(Int, String?)
    case network
    case decoding

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "手机号或密码错误"
        case .server(_, let msg): return msg ?? "服务器开小差了，请稍后再试"
        case .network: return "网络异常，请检查网络连接"
        case .decoding: return "数据解析失败"
        }
    }
}

/// 让任意 Encodable 可被 JSONEncoder 编码
struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void
    init(_ wrapped: Encodable) {
        encodeClosure = { encoder in try wrapped.encode(to: encoder) }
    }
    func encode(to encoder: Encoder) throws { try encodeClosure(encoder) }
}

/// 统一网络层：URLSession + async/await + Bearer 注入 + 401 处理。
/// 与 Android APIClient/AuthInterceptor 等价；不处理 CSRF（无 cookie，后端对 Bearer 放行）。
final class APIClient {
    static let shared = APIClient()
    private init() {}

    /// 401 通知；SessionStore 订阅后清状态、跳登录页
    static let unauthorizedNotification = Notification.Name("vxin.unauthorized")

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    // MARK: - JSON 请求
    func send<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Encodable? = nil,
        authorized: Bool = true
    ) async throws -> T {
        var request = try makeRequest(path: path, method: method, authorized: authorized)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: request) }
        catch { throw APIError.network }
        return try handle(data: data, response: response)
    }

    // MARK: - 媒体上传（multipart/form-data，字段名固定 file）
    func upload<T: Decodable>(
        _ path: String,
        fileData: Data,
        fileName: String,
        mimeType: String,
        fieldName: String = "file"
    ) async throws -> T {
        var request = try makeRequest(path: path, method: "POST", authorized: true)
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.appendString("--\(boundary)\r\n")
        body.appendString("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(fileName)\"\r\n")
        body.appendString("Content-Type: \(mimeType)\r\n\r\n")
        body.append(fileData)
        body.appendString("\r\n--\(boundary)--\r\n")

        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.upload(for: request, from: body) }
        catch { throw APIError.network }
        return try handle(data: data, response: response)
    }

    // MARK: - 内部
    private func makeRequest(path: String, method: String, authorized: Bool) throws -> URLRequest {
        guard let url = URL(string: ServerConfig.shared.baseURL + "/" + path) else { throw APIError.network }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if authorized, let token = KeychainStore.shared.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func handle<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        switch http.statusCode {
        case 200..<300:
            if T.self == EmptyResponse.self { return EmptyResponse() as! T }
            do { return try decoder.decode(T.self, from: data) }
            catch { throw APIError.decoding }
        case 401:
            KeychainStore.shared.token = nil
            NotificationCenter.default.post(name: Self.unauthorizedNotification, object: nil)
            throw APIError.unauthorized
        default:
            let message = try? decoder.decode(APIErrorBody.self, from: data).error
            throw APIError.server(http.statusCode, message)
        }
    }
}

private extension Data {
    mutating func appendString(_ string: String) {
        if let d = string.data(using: .utf8) { append(d) }
    }
}
