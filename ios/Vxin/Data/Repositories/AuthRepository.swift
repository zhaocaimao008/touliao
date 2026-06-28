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
        applyAuth(res)
        return res.user
    }

    private func applyAuth(_ res: AuthResponse) {
        KeychainStore.shared.token = res.token   // active token
        AccountStore.shared.upsertActive(StoredAccount(id: res.user.id, username: res.user.username, avatar: res.user.avatar, token: res.token))
    }

    func register(phone: String, password: String, username: String, inviteCode: String) async throws -> User {
        let res: AuthResponse = try await api.send(
            "api/auth/register", method: "POST",
            body: RegisterBody(
                phone: phone.trimmingCharacters(in: .whitespaces),
                password: password,
                username: username.trimmingCharacters(in: .whitespaces),
                inviteCode: inviteCode.trimmingCharacters(in: .whitespaces)
            ),
            authorized: false
        )
        applyAuth(res)
        return res.user
    }

    /// 找回密码(免登录):手机号+邀请码+新密码。与 web/Android 对齐。
    func resetPassword(phone: String, inviteCode: String, newPassword: String) async throws {
        let _: EmptyResponse = try await api.send(
            "api/auth/reset-password", method: "POST",
            body: ResetPasswordBody(
                phone: phone.trimmingCharacters(in: .whitespaces),
                inviteCode: inviteCode.trimmingCharacters(in: .whitespaces),
                newPassword: newPassword
            ),
            authorized: false
        )
    }

    /// 启动时凭已存 token 校验会话
    func restoreSession() async -> User? {
        guard KeychainStore.shared.isLoggedIn else { return nil }
        return try? await api.send("api/auth/me")
    }

    func logout() async {
        let _: EmptyResponse? = try? await api.send("api/auth/logout", method: "POST")
        if let active = AccountStore.shared.activeId() { AccountStore.shared.remove(active) }
        KeychainStore.shared.clear()
    }
}
