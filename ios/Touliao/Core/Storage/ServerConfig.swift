import Foundation

/// 服务器地址（永不重编译换服务器）。对应 Android ServerConfig。
/// 生效优先级：手动切换(调试) > 远程 config.json > 编译内置默认。
///
/// 凭据归属（审计 F02）：登录 token 绑定签发它的服务器 origin。生效 origin 一旦变化，
/// 在同一把 KeychainStore 锁内推进身份代次并清除 token，再广播 originDidChangeNotification，
/// 由 SessionStore 断开 socket、清缓存、回登录页——旧服务器的 Bearer 不会发往新服务器。
final class ServerConfig {
    static let shared = ServerConfig()

    /// 生效 origin 变化后广播；userInfo["marker"] 为清除后的 KeychainStore.Snapshot。
    static let originDidChangeNotification = Notification.Name("vxin.serverOriginChanged")

    private let defaults: UserDefaults
    private let credentials: () -> KeychainStore

    init(defaults: UserDefaults = .standard, credentials: @escaping () -> KeychainStore = { .shared }) {
        self.defaults = defaults
        self.credentials = credentials
    }

    /// 编译内置兜底（仅在远程+无手动覆盖时使用）
    static let defaultURL = "https://touliao.cc"

    private let overrideKey = "vxin_base_url_override"   // 手动「切换服务器」
    private let remoteKey = "vxin_base_url_remote"       // RemoteConfig 拉取写入

    /// 生效地址；setter 写入「手动覆盖」（登录页切换服务器用）
    var baseURL: String {
        get { manualOverride ?? remote ?? Self.defaultURL }
        set {
            let v = normalize(newValue)
            guard Self.origin(of: v) != nil else { return }
            apply { defaults.set(v, forKey: overrideKey) }
        }
    }

    /// 当前生效地址的规范化 origin（凭据归属键）。
    var origin: String { Self.origin(of: baseURL) ?? Self.origin(of: Self.defaultURL)! }

    /// RemoteConfig 写入远程地址（不覆盖用户手动切换）
    func setRemote(_ url: String) {
        let v = normalize(url)
        guard Self.origin(of: v) != nil else { return }
        apply { defaults.set(v, forKey: remoteKey) }
    }

    func clearManualOverride() {
        apply { defaults.removeObject(forKey: overrideKey) }
    }

    /// scheme + 小写 host + 非默认端口；路径、查询、用户信息不参与凭据归属。仅接受 http/https。
    static func origin(of raw: String) -> String? {
        guard let parts = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = parts.host?.lowercased(), !host.isEmpty else { return nil }
        if let port = parts.port, port != (scheme == "https" ? 443 : 80) { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }

    /// 在凭据锁内写配置；生效 origin 变化则作废当前身份并清除 token。
    private func apply(_ write: () -> Void) {
        let store = credentials()
        let marker: KeychainStore.Snapshot? = store.synchronized {
            let before = origin
            write()
            guard origin != before else { return nil }
            store.beginIdentityChange()
            store.clear()
            return store.snapshot()
        }
        guard let marker else { return }
        NotificationCenter.default.post(name: Self.originDidChangeNotification, object: self, userInfo: ["marker": marker])
    }

    private var manualOverride: String? {
        defaults.string(forKey: overrideKey).flatMap { $0.isEmpty ? nil : $0 }
    }
    private var remote: String? {
        defaults.string(forKey: remoteKey).flatMap { $0.isEmpty ? nil : $0 }
    }

    private func normalize(_ s: String) -> String {
        var v = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while v.hasSuffix("/") { v.removeLast() }
        return v
    }
}
