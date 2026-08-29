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

    /// 取原始字节（带 Bearer），用于二维码 PNG 等非 JSON 响应。
    func fetchData(_ path: String) async throws -> Data {
        let request = try makeRequest(path: path, method: "GET", authorized: true)
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await URLSession.shared.data(for: request) }
        catch { throw APIError.network }
        guard let http = response as? HTTPURLResponse else { throw APIError.network }
        switch http.statusCode {
        case 200..<300: return data
        case 401:
            KeychainStore.shared.token = nil
            NotificationCenter.default.post(name: Self.unauthorizedNotification, object: nil)
            throw APIError.unauthorized
        default: throw APIError.server(http.statusCode, nil)
        }
    }

    // MARK: - 媒体上传（multipart/form-data，字段名固定 file）
    func upload<T: Decodable>(
        _ path: String,
        fileData: Data,
        fileName: String,
        mimeType: String,
        fieldName: String = "file",
        method: String = "POST"
    ) async throws -> T {
        var request = try makeRequest(path: path, method: method, authorized: true)
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

    /// 2026-08-29 新增：大文件(视频)流式上传。与上面 `upload(fileData:)` 走同一 multipart 接口，
    /// 唯一区别是请求体来自磁盘文件而非内存 Data——避免把几百MB视频整个读进内存(那样会OOM崩溃)。
    /// 做法：把 multipart 的头/尾字节 + 源文件内容，用小缓冲区分块拷贝拼成一个"信封"临时文件，
    /// 再用 `URLSession.upload(for:fromFile:)` 从磁盘流式发送；峰值内存只有缓冲区大小(64KB)量级，
    /// 与文件大小无关。不改变后端 multipart 协议——服务端收到的字节序列与内存方式完全一致。
    func uploadFileStream<T: Decodable>(
        _ path: String,
        fileURL: URL,
        fileName: String,
        mimeType: String,
        fieldName: String = "file",
        method: String = "POST",
        onProgress: (@Sendable (Double) -> Void)? = nil
    ) async throws -> T {
        var request = try makeRequest(path: path, method: method, authorized: true)
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let envelopeURL = try Self.buildMultipartEnvelope(
            sourceFile: fileURL, boundary: boundary, fieldName: fieldName, fileName: fileName, mimeType: mimeType
        )
        defer { try? FileManager.default.removeItem(at: envelopeURL) }

        let delegate = onProgress.map { UploadProgressDelegate(onProgress: $0) }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.upload(for: request, fromFile: envelopeURL, delegate: delegate)
        } catch { throw APIError.network }
        return try handle(data: data, response: response)
    }

    /// 把 multipart 头部 + 源文件内容 + 尾部拼接写入一个新的临时"信封"文件。
    /// 用 64KB 缓冲区循环读写源文件，不整体载入内存；文件越大只是循环次数越多，内存占用不变。
    private static func buildMultipartEnvelope(sourceFile: URL, boundary: String, fieldName: String, fileName: String, mimeType: String) throws -> URL {
        let header = "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(fileName)\"\r\nContent-Type: \(mimeType)\r\n\r\n"
        let footer = "\r\n--\(boundary)--\r\n"
        let envelopeURL = FileManager.default.temporaryDirectory.appendingPathComponent("upload-envelope-\(UUID().uuidString)")
        FileManager.default.createFile(atPath: envelopeURL.path, contents: nil)
        guard let out = try? FileHandle(forWritingTo: envelopeURL) else { throw APIError.network }
        defer { try? out.close() }
        out.write(header.data(using: .utf8)!)
        guard let inp = InputStream(url: sourceFile) else { throw APIError.network }
        inp.open()
        defer { inp.close() }
        let bufSize = 64 * 1024
        var buf = [UInt8](repeating: 0, count: bufSize)
        while inp.hasBytesAvailable {
            let n = inp.read(&buf, maxLength: bufSize)
            if n < 0 { throw APIError.network }
            if n == 0 { break }
            out.write(Data(bytes: buf, count: n))
        }
        out.write(footer.data(using: .utf8)!)
        return envelopeURL
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

/// 大文件流式上传的进度回调代理，供 `uploadFileStream` 使用。
private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate {
    let onProgress: @Sendable (Double) -> Void
    init(onProgress: @escaping @Sendable (Double) -> Void) { self.onProgress = onProgress }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        onProgress(Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }
}
