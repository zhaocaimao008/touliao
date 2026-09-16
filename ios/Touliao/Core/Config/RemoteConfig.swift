import Foundation

private struct RemoteConfigDto: Decodable {
    var api: String = ""
    var socket: String = ""
    var cdn: String = ""
    var version: String = ""
}

/// 企业代码目录里一条记录：代码 → 该客户自己的服务器地址（+ 展示名，便于用户核对）。
private struct DirectoryEntry: Decodable {
    var api: String = ""
    var name: String = ""
}

/// 远程配置（永不重编译换服务器）。启动时从 configURLs 依次拉取 config.json，
/// 取 api 写入 ServerConfig.remote。换服务器只需改 config.json（与 Web/Android 一致）。
enum RemoteConfig {
    /// 引导地址（稳定，唯一编译常量）；与 web/src/utils/config.js、Android RemoteConfig 一致
    static let configURLs = [
        "https://touliao.cc/config.json",
        "https://www.touliao.cc/config.json",
    ]

    /// 企业代码目录：与 configURLs 并列的独立引导数据。config.json 回答"默认连谁"，
    /// directory.json 回答"这个企业代码对应连谁"——多个客户各自独立服务器/独立数据库，
    /// 共用同一个 App 时，靠这份表把用户输入的短代码解析成客户自己的服务器地址。
    static let directoryURLs = [
        "https://touliao.cc/directory.json",
        "https://www.touliao.cc/directory.json",
    ]

    /// 按企业代码查找服务器地址；仅在用户在登录页主动输入代码时才调用，不影响启动流程。
    /// 查到目录但代码不存在时不再尝试其余镜像（内容应一致）。
    static func resolve(code: String) async -> (api: String, name: String)? {
        let key = code.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !key.isEmpty else { return nil }
        for urlStr in directoryURLs {
            guard let url = URL(string: urlStr) else { continue }
            do {
                var req = URLRequest(url: url)
                req.timeoutInterval = 6
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { continue }
                let table = try JSONDecoder().decode([String: DirectoryEntry].self, from: data)
                guard let entry = table[key], !entry.api.isEmpty else { return nil }
                return (entry.api, entry.name)
            } catch {
                continue
            }
        }
        return nil
    }

    /// 拉取并应用远程服务器地址；失败则保留上次缓存/默认。请在首个网络请求前 await 调用。
    static func refresh() async {
        for urlStr in configURLs {
            guard let url = URL(string: urlStr) else { continue }
            do {
                var req = URLRequest(url: url)
                req.timeoutInterval = 6
                let (data, resp) = try await URLSession.shared.data(for: req)
                guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { continue }
                let cfg = try JSONDecoder().decode(RemoteConfigDto.self, from: data)
                let api = cfg.api.isEmpty ? cfg.socket : cfg.api
                if !api.isEmpty {
                    ServerConfig.shared.setRemote(api)
                    print("[RemoteConfig] server = \(api) (from \(urlStr))")
                    return
                }
            } catch {
                continue
            }
        }
        print("[RemoteConfig] 远程不可达，沿用上次/默认: \(ServerConfig.shared.baseURL)")
    }
}
