import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case server(Int, String?)
    case network
    case decoding
    // 2026-08-29新增：源文件本身有问题(拷贝/映射得到空文件、读取失败)，与真实网络故障区分开，
    // 避免用户看到"网络异常"却误以为是WiFi问题——本轮视频上传失败排查缺乏真机数据，
    // 先把这类问题的报错文案精确化，方便下次复现时一眼定位是哪一步。
    case invalidSourceFile(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "手机号或密码错误"
        case .server(_, let msg): return msg ?? "服务器开小差了，请稍后再试"
        case .network: return "网络异常，请检查网络连接"
        case .decoding: return "数据解析失败"
        case .invalidSourceFile(let reason): return reason
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
        method: String = "POST",
        duration: Int = 0
    ) async throws -> T {
        var request = try makeRequest(path: path, method: method, authorized: true)
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        // 2026-08-29新增：语音/视频时长(秒)，与后端 duration 字段对齐。
        if duration > 0 {
            body.appendString("--\(boundary)\r\n")
            body.appendString("Content-Disposition: form-data; name=\"duration\"\r\n\r\n")
            body.appendString("\(duration)")
            body.appendString("\r\n")
        }
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
    /// 唯一区别是请求体来自磁盘文件(通过内存映射读取)而非整体载入内存 Data。
    /// 做法：把 multipart 头/尾字节 + 源文件内容(内存映射)拼成一个"信封"临时文件，
    /// 再用 `URLSession.upload(for:fromFile:)` 从磁盘流式发送。不改变后端 multipart 协议——
    /// 服务端收到的字节序列与旧的内存方式完全一致。
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
    ///
    /// 2026-08-29 两轮修复记录：
    /// 第一版用 `InputStream(url:)` + `hasBytesAvailable` 判断结束，真机上会导致视频内容
    /// 整段丢失(信封文件里只有头尾、中间为空 → 服务端收到0字节附件 → Android播放黑屏00:00)。
    /// 第二版改手写 `FileHandle.read(upToCount:)` 循环，真机反馈视频改成"发送失败"(疑似该版本
    /// 循环写入环节有其他边界问题，未能100%复现定位)。
    /// 现改用 `Data(contentsOf:options:.mappedIfSafe)` —— iOS 官方为"大文件不整体占内存"
    /// 场景提供的标准方案(内存映射，读取时由系统按需分页载入，不会把几百MB一次性放进堆内存)，
    /// 比手写分块读写循环更简单、更少自定义逻辑出错的空间，是Apple自己推荐的成熟模式。
    private static func buildMultipartEnvelope(sourceFile: URL, boundary: String, fieldName: String, fileName: String, mimeType: String) throws -> URL {
        let header = "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(fileName)\"\r\nContent-Type: \(mimeType)\r\n\r\n"
        let footer = "\r\n--\(boundary)--\r\n"
        // 2026-08-29：真机确认 temporaryDirectory 会在 App 短暂挂起期间被系统清空(见 PickedVideoFile
        // 顶部说明)，大文件上传耗时可能覆盖一次这样的挂起窗口，信封文件同样改放 Caches 目录。
        let envelopeDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("touliao-upload-envelope", isDirectory: true)
        try? FileManager.default.createDirectory(at: envelopeDir, withIntermediateDirectories: true)
        let envelopeURL = envelopeDir.appendingPathComponent("upload-envelope-\(UUID().uuidString)")
        FileManager.default.createFile(atPath: envelopeURL.path, contents: nil)
        guard let out = try? FileHandle(forWritingTo: envelopeURL) else {
            throw APIError.invalidSourceFile("临时文件创建失败，请重试")
        }
        defer { try? out.close() }
        out.write(header.data(using: .utf8)!)

        let mapped: Data
        do {
            mapped = try Data(contentsOf: sourceFile, options: .mappedIfSafe)
        } catch {
            // 读取阶段就失败(文件不存在/无权限/系统提前清理了临时文件)，与"网络异常"是两回事，
            // 之前统一报 APIError.network 会让人误以为是网络问题而反复重试，其实重试也没用。
            throw APIError.invalidSourceFile("视频文件读取失败(\(error.localizedDescription))，请重新选择")
        }
        if mapped.isEmpty {
            // 源文件确实是空的(而不是读取环节的问题)，此前静默发出空文件正是Android黑屏的根因，
            // 这里直接拒绝，不再让空附件进后端。
            throw APIError.invalidSourceFile("视频文件为空，请重新选择")
        }
        out.write(mapped)
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
