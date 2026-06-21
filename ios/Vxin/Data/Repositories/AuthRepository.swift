import Foundation

/// 认证仓库。与 Android AuthRepository 等价。
final class AuthRepository {
    static let shared = AuthRepository()
    private init() {}

    private let api = APIClient.shared

    func login(phone: String, password: String) async throws -> User {
        let res: AuthResponse = try await api.send(
            "api/auth/login", method: "POST",
            body: LoginBody(phone: phone.trimmingCharacters(in: .whitespaces), password: password),
            authorized: false
        )
        KeychainStore.shared.token = res.token   // 先存 token，后续请求自动带 Bearer
        return res.user
    }

    func register(phone: String, password: String, username: String) async throws -> User {
        let res: AuthResponse = try await api.send(
            "api/auth/register", method: "POST",
            body: RegisterBody(
                phone: phone.trimmingCharacters(in: .whitespaces),
                password: password,
                username: username.trimmingCharacters(in: .whitespaces)
            ),
            authorized: false
        )
        KeychainStore.shared.token = res.token
        return res.user
    }

    /// 启动时凭已存 token 校验会话
    func restoreSession() async -> User? {
        guard KeychainStore.shared.isLoggedIn else { return nil }
        return try? await api.send("api/auth/me")
    }

    func logout() async {
        let _: EmptyResponse? = try? await api.send("api/auth/logout", method: "POST")
        KeychainStore.shared.clear()
    }
}
