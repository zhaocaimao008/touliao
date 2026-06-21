import Foundation

/// 服务器地址配置（可运行时切换，持久化到 UserDefaults）。对应 Android ServerConfig。
final class ServerConfig {
    static let shared = ServerConfig()
    private init() {}

    /// 默认服务器地址（真机联调请改成你的域名，或在登录页「切换服务器」修改）
    static let defaultURL = "https://dipsin.com"

    private let key = "vxin_base_url"

    var baseURL: String {
        get { UserDefaults.standard.string(forKey: key) ?? Self.defaultURL }
        set {
            var v = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            while v.hasSuffix("/") { v.removeLast() }
            if !v.isEmpty { UserDefaults.standard.set(v, forKey: key) }
        }
    }
}
