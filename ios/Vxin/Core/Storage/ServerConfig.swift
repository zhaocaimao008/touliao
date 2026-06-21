import Foundation

/// 服务器地址（永不重编译换服务器）。对应 Android ServerConfig。
/// 生效优先级：手动切换(调试) > 远程 config.json > 编译内置默认。
final class ServerConfig {
    static let shared = ServerConfig()
    private init() {}

    /// 编译内置兜底（仅在远程+无手动覆盖时使用）
    static let defaultURL = "https://dipsin.com"

    private let overrideKey = "vxin_base_url_override"   // 手动「切换服务器」
    private let remoteKey = "vxin_base_url_remote"       // RemoteConfig 拉取写入

    /// 生效地址；setter 写入「手动覆盖」（登录页切换服务器用）
    var baseURL: String {
        get { manualOverride ?? remote ?? Self.defaultURL }
        set {
            let v = normalize(newValue)
            if !v.isEmpty { UserDefaults.standard.set(v, forKey: overrideKey) }
        }
    }

    /// RemoteConfig 写入远程地址（不覆盖用户手动切换）
    func setRemote(_ url: String) {
        let v = normalize(url)
        if !v.isEmpty { UserDefaults.standard.set(v, forKey: remoteKey) }
    }

    func clearManualOverride() { UserDefaults.standard.removeObject(forKey: overrideKey) }

    private var manualOverride: String? {
        UserDefaults.standard.string(forKey: overrideKey).flatMap { $0.isEmpty ? nil : $0 }
    }
    private var remote: String? {
        UserDefaults.standard.string(forKey: remoteKey).flatMap { $0.isEmpty ? nil : $0 }
    }

    private func normalize(_ s: String) -> String {
        var v = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while v.hasSuffix("/") { v.removeLast() }
        return v
    }
}
