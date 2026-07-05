import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    // 登录表单
    @Published var phone = ""
    @Published var password = ""
    @Published var serverURL = ServerConfig.shared.baseURL
    // 注册额外字段
    @Published var username = ""
    @Published var inviteCode = ""   // 6位数字邀请码；是否必填由 inviteRequired 决定
    /// 注册是否需要邀请码（GET /api/config）；拉取前保守视为需要，后端最终裁决
    @Published var inviteRequired = true
    // 找回密码
    @Published var resetNewPassword = ""
    @Published var resetDone = false

    @Published var loading = false
    @Published var error: String?
    /// 登录/注册成功后置为对应用户；View 监听后通知 SessionStore
    @Published var authedUser: User?

    /// 后端密码规则:≥8位且含字母和数字
    private func isValidPassword(_ p: String) -> Bool {
        p.range(of: "^(?=.*[a-zA-Z])(?=.*\\d).{8,}$", options: .regularExpression) != nil
    }

    var canLogin: Bool { !phone.isEmpty && !password.isEmpty && !loading }
    var canRegister: Bool {
        !username.isEmpty && !phone.isEmpty && isValidPassword(password)
            && (!inviteRequired || inviteCode.count == 6) && !loading
    }
    var canReset: Bool {
        !phone.isEmpty && inviteCode.count == 6 && isValidPassword(resetNewPassword) && !loading
    }

    /// 拉取后台开关，决定注册是否需要邀请码。失败保持默认（需要）。
    func loadConfig() async {
        guard let cfg: RegisterConfig = try? await APIClient.shared.send("api/config", authorized: false)
        else { return }
        inviteRequired = cfg.features?.inviteRequired ?? true
    }

    /// 切换服务器地址：持久化，后续请求即生效
    func saveServerURL() {
        let url = serverURL.trimmingCharacters(in: .whitespaces)
        if !url.isEmpty { ServerConfig.shared.baseURL = url }
    }

    func login() {
        guard canLogin else { return }
        saveServerURL()
        loading = true
        error = nil
        Task {
            do {
                authedUser = try await AuthRepository.shared.login(phone: phone, password: password)
            } catch let err {
                error = (err as? LocalizedError)?.errorDescription ?? "登录失败"
            }
            loading = false
        }
    }

    func register() {
        guard canRegister else { return }
        loading = true
        error = nil
        Task {
            do {
                authedUser = try await AuthRepository.shared.register(phone: phone, password: password, username: username, inviteCode: inviteCode)
            } catch let err {
                error = (err as? LocalizedError)?.errorDescription ?? "注册失败"
            }
            loading = false
        }
    }

    /// 找回密码:成功后置 resetDone,View 据此返回登录
    func resetPassword() {
        guard canReset else { return }
        saveServerURL()
        loading = true
        error = nil
        Task {
            do {
                try await AuthRepository.shared.resetPassword(phone: phone, inviteCode: inviteCode, newPassword: resetNewPassword)
                resetDone = true
            } catch let err {
                error = (err as? LocalizedError)?.errorDescription ?? "重置失败"
            }
            loading = false
        }
    }
}

/// GET /api/config 响应（仅取注册所需的邀请码开关）。字段缺省时按需要邀请码处理。
private struct RegisterConfig: Decodable {
    struct Features: Decodable { let inviteRequired: Bool? }
    let features: Features?
}
